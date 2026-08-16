// Поведінковий тест самостійного скасування заявки пацієнтом:
// власність (tenant + phone + identity scope), дозволені стани, журнал події.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedPatientSession } from "./helpers/d1.mjs";

async function seed(db, {
  code,
  phoneNormalized,
  status = "new",
  orgId = 1,
  dob = "1990-05-05",
  time = "10:00",
}) {
  await db.prepare(
    `INSERT INTO bookings (code, name, phone, phone_normalized, service, service_code,
       desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(code, "Пацієнт", "+" + phoneNormalized, phoneNormalized, "КТ", "CT-01",
    "2026-09-01", time, status, dob, "civilian", orgId).run();
}

const cancel = (db, cookie, code) =>
  callWorker(jsonRequest("/api/booking-status", { code, action: "cancel" }, { method: "PATCH", headers: { cookie } }), db);

test("a patient cancels their own active booking; status and event are written", async () => {
  await withD1(async (db) => {
    await seed(db, { code: "RD-OWN0000001", phoneNormalized: "380971112233" });
    const cookie = await seedPatientSession(db, "380971112233");
    const res = await cancel(db, cookie, "RD-OWN0000001");
    assert.equal(res.status, 200);
    const row = await db.prepare("SELECT status FROM bookings WHERE code = ?").bind("RD-OWN0000001").first("status");
    assert.equal(row, "cancelled");
    const order = await db.prepare(
      `SELECT d.state FROM patient_order_details o
       JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
       JOIN bookings b ON b.id=o.booking_id AND b.organization_id=o.organization_id
       WHERE b.code=? AND o.organization_id=1`
    ).bind("RD-OWN0000001").first("state");
    assert.equal(order, "cancelled");
    const ev = await db.prepare("SELECT COUNT(*) AS n FROM booking_events WHERE action = 'cancelled'").first("n");
    assert.equal(ev, 1);
  });
});

test("patient cancellation event is attributed to the session organization", async () => {
  await withD1(async (db) => {
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Інша', 1)"
    ).run();
    await seed(db, { code: "RD-ORG2000001", phoneNormalized: "380991112233", orgId: 2 });
    const cookie = await seedPatientSession(db, "380991112233", 2);
    const res = await cancel(db, cookie, "RD-ORG2000001");
    assert.equal(res.status, 200);
    const event = await db.prepare(
      "SELECT organization_id AS organizationId FROM booking_events WHERE action = 'cancelled' ORDER BY id DESC LIMIT 1"
    ).first();
    assert.equal(event.organizationId, 2);
  });
});

test("a patient cannot cancel someone else's booking", async () => {
  await withD1(async (db) => {
    await seed(db, { code: "RD-OWN0000002", phoneNormalized: "380971112233", dob:"1990-05-05", time:"10:00" });
    await seed(db, { code: "RD-OTHER00001", phoneNormalized: "380975556677", dob:"1985-04-04", time:"10:30" });
    const cookie = await seedPatientSession(db, "380971112233");
    const res = await cancel(db, cookie, "RD-OTHER00001");
    assert.equal(res.status, 404);
    const row = await db.prepare("SELECT status FROM bookings WHERE code = ?").bind("RD-OTHER00001").first("status");
    assert.equal(row, "new");
  });
});

test("a paid booking returns 409 until finance is refunded", async () => {
  await withD1(async (db) => {
    await seed(db, { code: "RD-PAIDCANCEL1", phoneNormalized: "380971112233" });
    const booking = await db.prepare(
      "SELECT id FROM bookings WHERE organization_id=1 AND code='RD-PAIDCANCEL1'"
    ).first();
    await db.prepare(
      `INSERT INTO payment_transactions
       (organization_id,booking_id,amount,currency,provider,provider_reference,status,paid_at)
       VALUES (1,?,1500,'UAH','legacy','cancel-paid','paid',CURRENT_TIMESTAMP)`
    ).bind(booking.id).run();
    const cookie = await seedPatientSession(db, "380971112233");
    const res = await cancel(db, cookie, "RD-PAIDCANCEL1");
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error,/оплата|повернення/i);
    assert.equal(await db.prepare("SELECT status FROM bookings WHERE id=?").bind(booking.id).first("status"),"new");
    assert.equal(await db.prepare(
      `SELECT d.state FROM patient_order_details o
       JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
       WHERE o.organization_id=1 AND o.booking_id=?`
    ).bind(booking.id).first("state"),"draft");
  });
});

test("an already-performed booking cannot be cancelled online", async () => {
  await withD1(async (db) => {
    await seed(db, { code: "RD-DONE000001", phoneNormalized: "380971112233", status: "issued" });
    const cookie = await seedPatientSession(db, "380971112233");
    const res = await cancel(db, cookie, "RD-DONE000001");
    assert.equal(res.status, 409);
  });
});

test("cancelling requires a verified session", async () => {
  await withD1(async (db) => {
    await seed(db, { code: "RD-NOSESS0001", phoneNormalized: "380971112233" });
    const res = await callWorker(
      jsonRequest("/api/booking-status", { code: "RD-NOSESS0001", action: "cancel" }, { method: "PATCH" }), db);
    assert.equal(res.status, 401);
  });
});
