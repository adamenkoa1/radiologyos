import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseLeadHours, dueReminders, leadReminderText, kyivNow, REMINDER_LEAD_DEFAULT,
  daysBetween, addDaysToDate, minutesUntilBooking, visitDayLabel, reminderChannelChain,
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
  assert.match(text, /сьогодні/); // типовий підпис дня
  // Нагадування «напередодні» помічає день візиту.
  assert.match(leadReminderText("МРТ", "08:30", 24, "завтра"), /завтра о 08:30/);
});

test("daysBetween / addDaysToDate handle calendar boundaries", () => {
  assert.equal(daysBetween("2026-07-15", "2026-07-15"), 0);
  assert.equal(daysBetween("2026-07-15", "2026-07-16"), 1);
  assert.equal(daysBetween("2026-07-31", "2026-08-01"), 1); // через межу місяця
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1); // через межу року
  assert.equal(daysBetween("bad", "2026-07-16"), null);
  assert.equal(addDaysToDate("2026-07-31", 1), "2026-08-01");
  assert.equal(addDaysToDate("2026-12-31", 1), "2027-01-01");
});

test("minutesUntilBooking crosses midnight so a day-before lead fires", () => {
  // Сьогодні 09:00, візит завтра 08:30 → 23 год 30 хв = 1410 хв.
  assert.equal(minutesUntilBooking("2026-07-15", 9 * 60, "2026-07-16", "08:30"), 23 * 60 + 30);
  // Візит сьогодні о 12:00, зараз 09:00 → 180 хв.
  assert.equal(minutesUntilBooking("2026-07-15", 9 * 60, "2026-07-15", "12:00"), 180);
  // 24-год лід для завтра о 09:00, зараз 09:05 → 1435 хв (у вікні 24 год).
  assert.equal(minutesUntilBooking("2026-07-15", 9 * 60 + 5, "2026-07-16", "09:00"), 24 * 60 - 5);
  assert.equal(minutesUntilBooking("2026-07-15", 540, "2026-07-16", "bad"), null);
});

test("a 24h (day-before) lead fires only inside its catch window for a next-day visit", () => {
  const leads = [24, 3, 1];
  // Завтра 09:00, зараз 09:10 сьогодні → 1430 хв (вікно 24 год = (1415, 1440]).
  const m = minutesUntilBooking("2026-07-15", 9 * 60 + 10, "2026-07-16", "09:00");
  assert.deepEqual(dueReminders([{ id: 7, minutesUntil: m }], leads, new Set()), [{ id: 7, hours: 24 }]);
  // Зарано: зараз 08:00 сьогодні → 1500 хв, ще не час.
  const early = minutesUntilBooking("2026-07-15", 8 * 60, "2026-07-16", "09:00");
  assert.deepEqual(dueReminders([{ id: 7, minutesUntil: early }], leads, new Set()), []);
});

test("visitDayLabel names today / tomorrow / explicit date", () => {
  assert.equal(visitDayLabel("2026-07-15", "2026-07-15"), "сьогодні");
  assert.equal(visitDayLabel("2026-07-16", "2026-07-15"), "завтра");
  assert.equal(visitDayLabel("2026-07-20", "2026-07-15"), "2026-07-20");
});

test("reminderChannelChain keeps the fixed Telegram→email→WhatsApp→SMS order", () => {
  assert.deepEqual(
    reminderChannelChain({ telegram: true, email: true, whatsapp: true, sms: true }),
    ["telegram", "email", "whatsapp", "sms"],
  );
  assert.deepEqual(reminderChannelChain({ email: true, whatsapp: true }), ["email", "whatsapp"]);
  assert.deepEqual(reminderChannelChain({ sms: true }), ["sms"]);
  assert.deepEqual(reminderChannelChain({}), []);
});

test("kyivNow converts a UTC instant to Kyiv date and minutes", () => {
  // 2026-07-15 12:00 UTC → Київ літній (UTC+3) = 15:00.
  const ms = Date.UTC(2026, 6, 15, 12, 0, 0);
  const { date, minutes } = kyivNow(ms);
  assert.equal(date, "2026-07-15");
  assert.equal(minutes, 15 * 60);
});

test("worker schedules tenant-limited reminders and internal operational tasks every 15 minutes", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /async function runTenantReminders\(db: D1Database, now: number\)/);
  assert.match(worker, /SELECT id FROM organizations WHERE active = 1 ORDER BY id/);
  assert.match(worker, /runDueReminders\(db, now, Number\(org\.id\)\)/);
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /const now=Date\.now\(\)/);
  assert.match(worker, /runTenantReminders\(env\.DB, now\)/);
  assert.match(worker, /runOperationalTasks\(env\.DB, now\)/);
  assert.match(worker, /Promise\.allSettled\(\[/);
  assert.doesNotMatch(worker, /INITIAL_ORGANIZATION_ID/);
  assert.match(worker, /ctx\.waitUntil/);
  const wrangler = await read("wrangler.cloudflare.toml");
  assert.match(wrangler, /workers_dev = false/);
  assert.match(wrangler, /\[triggers\][\s\S]*crons\s*=\s*\[\s*"\*\/15 \* \* \* \*"\s*\]/);
});

test("runner scopes bookings, dedupe and contact consent by exact identity and organization", async () => {
  const src = await read("lib/reminders.ts");
  assert.match(src, /WHERE b\.organization_id = \? AND b\.desired_date IN \(\?, \?\)/);
  assert.match(src, /p\.organization_id = b\.organization_id/);
  assert.match(src, /p\.patient_id = b\.patient_id/);
  assert.match(src, /p\.do_not_contact = 1/);
  assert.match(src, /sharedProfileCount/);
  assert.match(src, /staleLinkedContact/);
  assert.match(src, /!b\.patientId && b\.sharedProfileCount > 0/);
  assert.match(src, /sendWhatsApp\(db, b\.phoneNormalized, body, organizationId\)/);
  assert.match(src, /sendTelegramTo\(db, b\.telegramChatId, body, organizationId\)/);
  assert.match(src, /messaging\.sendEmail\(/);
  assert.match(src, /reminderChannelChain\(/);
  assert.match(src, /kind LIKE 'reminder_%h'/);
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
