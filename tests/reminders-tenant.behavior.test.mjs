import assert from "node:assert/strict";
import test from "node:test";
import { runDueReminders } from "../lib/reminders.ts";
import { withD1 } from "./helpers/d1.mjs";

async function setting(db, key, value) {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(key, value).run();
}

async function booking(db, organizationId, code, phone, phoneNormalized) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service,
       desired_date, desired_time, status)
     VALUES (?, ?, ?, ?, ?, 'КТ ОГК', '2026-07-15', '10:00', 'confirmed')`,
  ).bind(organizationId, code, `Пацієнт ${organizationId}`, phone, phoneNormalized).run();
  return Number(result.meta.last_row_id);
}

test("scheduled reminder runner never sends another organization's booking", async () => {
  await withD1(async (db) => {
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other-clinic', 'Other Clinic', 1)",
    ).run();
    await setting(db, "patient_reminders_enabled", "1");
    await setting(db, "reminder_lead_hours", "1");
    await setting(db, "whatsapp_enabled", "1");
    await setting(db, "whatsapp_id_instance", "123456");
    await setting(db, "whatsapp_api_token_instance", "secret-token");

    const ownBookingId = await booking(db, 1, "REM-ORG-1", "+380501111111", "380501111111");
    const foreignBookingId = await booking(db, 2, "REM-ORG-2", "+380502222222", "380502222222");

    const previousFetch = globalThis.fetch;
    const recipients = [];
    globalThis.fetch = async (_url, init = {}) => {
      const payload = JSON.parse(String(init.body || "{}"));
      recipients.push(payload.chatId);
      return Response.json({ idMessage: "msg-1" });
    };
    try {
      // 2026-07-15 06:00 UTC = 09:00 Kyiv; both bookings are exactly one hour away.
      const result = await runDueReminders(db, Date.UTC(2026, 6, 15, 6, 0, 0), 1);
      assert.deepEqual(result, { sent: 1, skipped: 0, failed: 0 });
      assert.deepEqual(recipients, ["380501111111@c.us"]);
    } finally {
      globalThis.fetch = previousFetch;
    }

    const rows = await db.prepare(
      "SELECT booking_id AS bookingId, status FROM patient_notifications ORDER BY id",
    ).all();
    assert.deepEqual(rows.results.map((row) => [row.bookingId, row.status]), [[ownBookingId, "sent"]]);
    assert.equal(rows.results.some((row) => row.bookingId === foreignBookingId), false);
  });
});

test("scheduled reminder runner applies do-not-contact only inside its tenant", async () => {
  await withD1(async (db) => {
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other-clinic', 'Other Clinic', 1)",
    ).run();
    await setting(db, "patient_reminders_enabled", "1");
    await setting(db, "reminder_lead_hours", "1");
    await setting(db, "whatsapp_enabled", "1");
    await setting(db, "whatsapp_id_instance", "123456");
    await setting(db, "whatsapp_api_token_instance", "secret-token");

    const ownBookingId = await booking(db, 1, "REM-DNC-1", "+380503333333", "380503333333");
    await db.prepare(
      `INSERT INTO patient_profiles
       (organization_id, phone_normalized, display_name, do_not_contact, updated_by)
       VALUES (1, '380503333333', 'Пацієнт', 1, 'test')`,
    ).run();

    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; return Response.json({ idMessage: "unexpected" }); };
    try {
      const result = await runDueReminders(db, Date.UTC(2026, 6, 15, 6, 0, 0), 1);
      assert.deepEqual(result, { sent: 0, skipped: 1, failed: 0 });
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = previousFetch;
    }

    const row = await db.prepare(
      "SELECT booking_id AS bookingId, status FROM patient_notifications ORDER BY id DESC LIMIT 1",
    ).first();
    assert.equal(row.bookingId, ownBookingId);
    assert.equal(row.status, "skipped");
  });
});
