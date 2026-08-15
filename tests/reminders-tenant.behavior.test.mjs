import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

const remindersSource = await readFile(new URL("../lib/reminders.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

async function booking(db, organizationId, code, phoneNormalized) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service,
       desired_date, desired_time, status)
     VALUES (?, ?, ?, ?, ?, 'КТ ОГК', '2026-07-15', '10:00', 'confirmed')`,
  ).bind(organizationId, code, `Пацієнт ${organizationId}`, `+${phoneNormalized}`, phoneNormalized).run();
  return Number(result.meta.last_row_id);
}

test("scheduled reminder SQL isolates bookings, dedupe and exact contact consent by organization", async () => {
  assert.match(remindersSource, /WHERE b\.organization_id = \? AND b\.desired_date = \? AND b\.status IN \('confirmed','rescheduled'\)/);
  assert.match(remindersSource, /JOIN bookings b ON b\.id = n\.booking_id[\s\S]*WHERE b\.organization_id = \?/);
  assert.match(remindersSource, /p\.organization_id = b\.organization_id/);
  assert.match(remindersSource, /p\.patient_id = b\.patient_id/);
  assert.match(remindersSource, /p\.do_not_contact = 1/);
  assert.match(remindersSource, /sharedProfileCount/);
  assert.match(remindersSource, /staleLinkedContact/);
  assert.match(remindersSource, /record\(db, organizationId, b, kind/);
  assert.match(
    remindersSource,
    /INSERT INTO patient_notifications[\s\S]*\(organization_id, booking_id, kind, channel, recipient, body, status, error, sent_at\)/,
  );
  assert.match(remindersSource, /\.bind\(organizationId, b\.id, kind/);

  await withD1(async (db) => {
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other-clinic', 'Other Clinic', 1)",
    ).run();
    const ownBookingId = await booking(db, 1, "REM-ORG-1", "380501111111");
    const foreignBookingId = await booking(db, 2, "REM-ORG-2", "380502222222");

    await db.prepare(
      `INSERT INTO patient_notifications
       (booking_id, kind, channel, recipient, body, status, error, sent_at)
       VALUES (?, 'reminder_1h', 'whatsapp', '+380502222222', 'foreign', 'sent', '', 'sent')`,
    ).bind(foreignBookingId).run();
    await db.prepare(
      `INSERT INTO patient_profiles
       (organization_id, phone_normalized, display_name, do_not_contact, updated_by)
       VALUES (2, '380502222222', 'Foreign patient', 1, 'test')`,
    ).run();

    const bookings = await db.prepare(
      `SELECT id FROM bookings
       WHERE organization_id = ? AND desired_date = ? AND status IN ('confirmed','rescheduled')`,
    ).bind(1, "2026-07-15").all();
    assert.deepEqual(bookings.results.map((row) => row.id), [ownBookingId]);

    const sent = await db.prepare(
      `SELECT n.booking_id AS bookingId
       FROM patient_notifications n
       JOIN bookings b ON b.id = n.booking_id
       WHERE b.organization_id = ? AND n.kind LIKE 'reminder_%h' AND b.desired_date = ?`,
    ).bind(1, "2026-07-15").all();
    assert.deepEqual(sent.results, []);

    const dnc = await db.prepare(
      "SELECT phone_normalized AS p FROM patient_profiles WHERE organization_id = ? AND do_not_contact = 1",
    ).bind(1).all();
    assert.deepEqual(dnc.results, []);
  });
});

test("production scheduled handler keeps patient reminders on org1 and operational jobs isolated", () => {
  assert.match(workerSource, /const INITIAL_ORGANIZATION_ID = 1/);
  assert.match(workerSource, /const now=Date\.now\(\)/);
  assert.match(
    workerSource,
    /runDueReminders\(env\.DB,\s*now,\s*INITIAL_ORGANIZATION_ID\)/,
  );
  assert.match(workerSource, /runOperationalTasks\(env\.DB,\s*now\)/);
  assert.match(workerSource, /Promise\.allSettled\(\[/);
  assert.match(workerSource, /async scheduled\s*\(/);
});
