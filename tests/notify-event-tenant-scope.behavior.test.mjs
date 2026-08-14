import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

test("manual notification event is attributed to the staff tenant", async () => {
  await withD1(async (db) => {
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'notify-org', 'Notify Org', 1)"
    ).run();
    const email = "notify-org2@example.com";
    const cookie = await seedStaffSession(db, { email, role: "admin", organizationId: 2 });
    const booking = await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, service, service_code,
         desired_date, desired_time, status, patient_category)
       VALUES (2, 'NOTIFY-ORG2', 'Patient', '+380501234567', '380501234567', 'CT', 'CT-01',
         '2026-09-01', '10:00', 'confirmed', 'civilian')`
    ).run();
    const bookingId = Number(booking.meta.last_row_id);

    const response = await callWorker(jsonRequest("/api/staff/notify", {
      bookingId,
      message: "Result is ready",
    }, { headers: { cookie } }), db);
    assert.equal(response.status, 200);

    const event = await db.prepare(
      `SELECT organization_id AS organizationId
       FROM booking_events WHERE booking_id = ? AND action = 'notified' ORDER BY id DESC LIMIT 1`
    ).bind(bookingId).first();
    assert.equal(event.organizationId, 2);
  });
});
