import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseLeadHours, dueReminders, leadReminderText, kyivNow, REMINDER_LEAD_DEFAULT,
} from "../lib/reminders-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("parseLeadHours normalises, validates range, dedupes and sorts", () => {
  assert.deepEqual(parseLeadHours("3, 1"), [3, 1]);
  assert.deepEqual(parseLeadHours("1;3;3"), [3, 1]); // унікальні, спадання
  assert.deepEqual(parseLeadHours(""), REMINDER_LEAD_DEFAULT); // порожнє → типове
  assert.deepEqual(parseLeadHours(null), REMINDER_LEAD_DEFAULT);
  assert.deepEqual(parseLeadHours("0, 25, 48"), REMINDER_LEAD_DEFAULT); // усі поза 1..24 → типове
  assert.deepEqual(parseLeadHours("2, 100, 4"), [4, 2]); // відкидає невалідні
});

test("dueReminders fires each lead once inside its catch window", () => {
  const leads = [3, 1];
  // 3 год = 180 хв; вікно (155, 180].
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 180 }], leads, new Set()), [{ id: 1, hours: 3 }]);
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 170 }], leads, new Set()), [{ id: 1, hours: 3 }]);
  // Зарано (>180) — ще не час.
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 190 }], leads, new Set()), []);
  // Пропущене вікно (нижче 155, але вище 60) — не дублюємо старий лід.
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 120 }], leads, new Set()), []);
  // 1 год = 60 хв; вікно (35, 60].
  assert.deepEqual(dueReminders([{ id: 2, minutesUntil: 55 }], leads, new Set()), [{ id: 2, hours: 1 }]);
});

test("dueReminders skips past appointments and already-sent leads", () => {
  const leads = [3, 1];
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: -10 }], leads, new Set()), []); // минуло
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 0 }], leads, new Set()), []); // зараз
  const sent = new Set(["1:reminder_3h"]);
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 175 }], leads, sent), []); // вже надіслано
});

test("leadReminderText mentions the lead hours, service and time", () => {
  const text = leadReminderText("КТ голови", "09:00", 3);
  assert.match(text, /за 3 год/);
  assert.match(text, /КТ голови/);
  assert.match(text, /09:00/);
});

test("kyivNow converts a UTC instant to Kyiv date and minutes", () => {
  // 2026-07-15 12:00 UTC → Київ літній (UTC+3) = 15:00.
  const ms = Date.UTC(2026, 6, 15, 12, 0, 0);
  const { date, minutes } = kyivNow(ms);
  assert.equal(date, "2026-07-15");
  assert.equal(minutes, 15 * 60);
});

test("worker runs due reminders on a cron schedule", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /runDueReminders\(env\.DB, Date\.now\(\)\)/);
  assert.match(worker, /ctx\.waitUntil/);
  const wrangler = await read("wrangler.cloudflare.toml");
  assert.match(wrangler, /\[triggers\]/);
  assert.match(wrangler, /crons = \[/);
});

test("runner sends WhatsApp, dedupes by kind and respects do-not-contact", async () => {
  const src = await read("lib/reminders.ts");
  assert.match(src, /sendWhatsApp\(db, b\.phoneNormalized, body\)/);
  assert.match(src, /kind LIKE 'reminder_%h'/); // дедуплікація
  assert.match(src, /do_not_contact = 1/); // «не турбувати»
  assert.match(src, /status IN \('confirmed','rescheduled'\)/);
});

test("settings expose the reminder lead-hours field", async () => {
  const route = await read("app/api/staff/settings/route.ts");
  assert.match(route, /REMINDER_LEAD_KEY/);
  assert.match(route, /reminderLeadHours/);
  const page = await read("app/staff/settings/page.tsx");
  assert.match(page, /reminderLeadHours/);
  assert.match(page, /годин до візиту/);
});
