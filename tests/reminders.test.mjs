import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseLeadHours, dueReminders, leadReminderText, kyivNow, REMINDER_LEAD_DEFAULT,
} from "../lib/reminders-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("parseLeadHours normalises, validates range, dedupes and sorts", () => {
  assert.deepEqual(parseLeadHours("3, 1"), [3, 1]);
  assert.deepEqual(parseLeadHours("1;3;3"), [3, 1]);
  assert.deepEqual(parseLeadHours(""), REMINDER_LEAD_DEFAULT);
  assert.deepEqual(parseLeadHours(null), REMINDER_LEAD_DEFAULT);
  assert.deepEqual(parseLeadHours("0, 25, 48"), REMINDER_LEAD_DEFAULT);
  assert.deepEqual(parseLeadHours("2, 100, 4"), [4, 2]);
});

test("dueReminders fires each lead once inside its catch window", () => {
  const leads = [3, 1];
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 180 }], leads, new Set()), [{ id: 1, hours: 3 }]);
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 170 }], leads, new Set()), [{ id: 1, hours: 3 }]);
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 190 }], leads, new Set()), []);
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 120 }], leads, new Set()), []);
  assert.deepEqual(dueReminders([{ id: 2, minutesUntil: 55 }], leads, new Set()), [{ id: 2, hours: 1 }]);
});

test("dueReminders skips past appointments and already-sent leads", () => {
  const leads = [3, 1];
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: -10 }], leads, new Set()), []);
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 0 }], leads, new Set()), []);
  assert.deepEqual(dueReminders([{ id: 1, minutesUntil: 175 }], leads, new Set(["1:reminder_3h"])), []);
});

test("leadReminderText mentions the lead hours, service and time", () => {
  const text = leadReminderText("КТ голови", "09:00", 3);
  assert.match(text, /за 3 год/);
  assert.match(text, /КТ голови/);
  assert.match(text, /09:00/);
});

test("kyivNow converts a UTC instant to Kyiv date and minutes", () => {
  const ms = Date.UTC(2026, 6, 15, 12, 0, 0);
  const { date, minutes } = kyivNow(ms);
  assert.equal(date, "2026-07-15");
  assert.equal(minutes, 15 * 60);
});

test("worker schedules reminder support for all active tenants every 15 minutes", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /runDueRemindersForActiveOrganizations\(env\.DB, Date\.now\(\)\)/);
  assert.doesNotMatch(worker, /INITIAL_ORGANIZATION_ID/);
  assert.match(worker, /ctx\.waitUntil/);
  const wrangler = await read("wrangler.cloudflare.toml");
  assert.match(wrangler, /workers_dev = false/);
  assert.match(wrangler, /\[triggers\][\s\S]*crons\s*=\s*\[\s*"\*\/15 \* \* \* \*"\s*\]/);
});

test("runner scopes bookings, dedupe, credentials and do-not-contact by organization", async () => {
  const src = await read("lib/reminders.ts");
  assert.match(src, /getTenantSettings\(db,/);
  assert.match(src, /WHERE organization_id = \? AND desired_date = \?/);
  assert.match(src, /n\.organization_id = \? AND b\.organization_id = \?/);
  assert.match(src, /patient_profiles WHERE organization_id = \? AND do_not_contact = 1/);
  assert.match(src, /sendWhatsApp\(db, b\.phoneNormalized, body, organizationId\)/);
  assert.match(src, /SELECT id FROM organizations WHERE active = 1/);
  assert.match(src, /kind LIKE 'reminder_%h'/);
});

test("settings expose the reminder lead-hours field", async () => {
  const route = await read("app/api/staff/settings/route.ts");
  assert.match(route, /REMINDER_LEAD_KEY/);
  assert.match(route, /reminderLeadHours/);
  const page = await read("app/staff/settings/page.tsx");
  assert.match(page, /reminderLeadHours/);
  assert.match(page, /годин до візиту/);
});
