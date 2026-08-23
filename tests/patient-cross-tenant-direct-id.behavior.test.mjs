// Cross-tenant direct-ID isolation for the patient cabinet.
//
// Checklist §1: "a tenant A patient cannot read or modify a tenant B record by
// direct ID." Existing tests cover identity isolation *within* one organization
// (shared family phone) and tenant scoping of the my-bookings *list*. This test
// closes the remaining hole: a patient holding a valid session in organization B
// must not reach organization A's booking through any direct-code endpoint —
// reads (my-protocol, booking-status), mutations (cancel) or money (pay-link) —
// even though the foreign code is real and its protocol is issued.
//
// A positive control (a correctly-scoped org-A session that *does* read the
// protocol) proves each 404 is tenant scoping, not a broken fixture.

import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedPatientSession, withD1 } from "./helpers/d1.mjs";

const ORG_A = 1;
const ORG_B = 2;

// Same phone + DOB in both tenants: isolation must hold on organization_id
// alone, not fall back to a phone/DOB coincidence.
const PHONE = "380631234567";
const DOB = "1988-04-12";
const CODE_A = "RD-ORGAAAAA0001";
const CODE_B = "RD-ORGBBBBB0001";

async function seedBooking(db, { organizationId, code, time, amount }) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, date_of_birth,
       service, service_code, equipment_id, desired_date, desired_time,
       patient_category, payment_status, payment_amount, status)
     VALUES (?, ?, 'Пацієнт', '+380631234567', ?, ?, 'КТ', '403', 'ct',
       '2026-09-12', ?, 'civilian', 'pending', ?, 'confirmed')`,
  ).bind(organizationId, code, PHONE, DOB, time, amount).run();
  return Number(result.meta.last_row_id);
}

async function issueProtocol(db, organizationId, bookingId, number, conclusion) {
  await db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, number, status, findings, conclusion, version, updated_by)
     VALUES (?, ?, ?, 'ready', 'Опис', ?, 1, 'doctor@example.com')`,
  ).bind(organizationId, bookingId, number, conclusion).run();
  await db.prepare(
    `UPDATE protocols
     SET status='signed', version=2, signed_by='doctor@example.com', signed_at=CURRENT_TIMESTAMP,
         signed_version=2, updated_by='doctor@example.com'
     WHERE organization_id=? AND booking_id=? AND status='ready'`,
  ).bind(organizationId, bookingId).run();
  await db.prepare(
    "UPDATE protocols SET status='issued' WHERE organization_id=? AND booking_id=? AND status='signed'",
  ).bind(organizationId, bookingId).run();
}

function patientRequest(path, cookie, body, method = "POST") {
  return jsonRequest(path, body, { method, headers: { cookie }, ip: "198.51.100.91" });
}

test("a patient session in tenant B cannot reach tenant A's record by direct code", async () => {
  await withD1(async (db) => {
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'org-b', 'Клініка Б', 1)",
    ).run();

    const bookingA = await seedBooking(db, { organizationId: ORG_A, code: CODE_A, time: "10:00", amount: 1500 });
    const bookingB = await seedBooking(db, { organizationId: ORG_B, code: CODE_B, time: "11:00", amount: 2500 });
    await issueProtocol(db, ORG_A, bookingA, "PR-A", "Висновок А — тільки для орендаря А");

    // Org B has its own online payment configured, so pay-link reaches the
    // tenant-scoped booking lookup rather than short-circuiting on config —
    // the 404 below proves the lookup itself refuses org A's code.
    await db.prepare(
      `INSERT INTO organization_integration_settings (organization_id, key, value, updated_at)
       VALUES (?, 'pay_link', 'https://example.test/pay-b', CURRENT_TIMESTAMP)`,
    ).bind(ORG_B).run();

    // Session belongs to organization B. Scoped by phone + DOB — both identical
    // to org A's booking — so the only thing keeping org A out is organization_id.
    const cookieB = await seedPatientSession(db, PHONE, ORG_B, { kind: "dob", value: DOB });

    // Read: the foreign protocol is invisible across the tenant boundary.
    const foreignProtocol = await callWorker(patientRequest("/api/my-protocol", cookieB, { code: CODE_A }), db);
    assert.equal(foreignProtocol.status, 404);
    assert.doesNotMatch(JSON.stringify(await foreignProtocol.json()), /Висновок А|PR-A/);

    // Read: public-ish status endpoint is equally scoped for an authed session.
    const foreignStatus = await callWorker(patientRequest("/api/booking-status", cookieB, { code: CODE_A }), db);
    assert.equal(foreignStatus.status, 404);

    // Mutation: cancelling across the boundary is a no-op, org A booking intact.
    const foreignCancel = await callWorker(
      patientRequest("/api/booking-status", cookieB, { code: CODE_A, action: "cancel" }, "PATCH"),
      db,
    );
    assert.equal(foreignCancel.status, 404);
    const stillConfirmed = await db.prepare("SELECT status FROM bookings WHERE id = ?").bind(bookingA).first("status");
    assert.equal(stillConfirmed, "confirmed");

    // Money: no payment intent can be minted against the foreign booking.
    const foreignPayLink = await callWorker(patientRequest("/api/pay-link", cookieB, { code: CODE_A }), db);
    assert.equal(foreignPayLink.status, 404);
    const foreignTx = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE organization_id = ? AND booking_id = ?",
    ).bind(ORG_A, bookingA).first("n");
    assert.equal(foreignTx, 0);
  });
});

test("positive control: a correctly-scoped tenant A session reads tenant A's protocol", async () => {
  await withD1(async (db) => {
    const bookingA = await seedBooking(db, { organizationId: ORG_A, code: CODE_A, time: "10:00", amount: 1500 });
    await issueProtocol(db, ORG_A, bookingA, "PR-A", "Висновок А — тільки для орендаря А");

    const cookieA = await seedPatientSession(db, PHONE, ORG_A, { kind: "booking", value: CODE_A });
    const ownProtocol = await callWorker(patientRequest("/api/my-protocol", cookieA, { code: CODE_A }), db);
    assert.equal(ownProtocol.status, 200);
    const body = await ownProtocol.json();
    assert.equal(body.protocol.conclusion, "Висновок А — тільки для орендаря А");
  });
});
