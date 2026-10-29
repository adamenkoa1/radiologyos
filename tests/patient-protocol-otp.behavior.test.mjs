import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedPatientSession, withD1 } from "./helpers/d1.mjs";

const PHONE = "380501112233";
const DOB = "1980-01-10";
const CODE = "RD-260910-001";

async function seedIssuedProtocol(db) {
  const booking = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, date_of_birth, service,
       service_code, equipment_id, desired_date, desired_time, patient_category,
       payment_status, payment_amount, status)
     VALUES (1, ?, 'Пацієнт Тест', '+380501112233', ?, ?, 'КТ', '403', 'ct',
       '2026-09-10', '10:00', 'civilian', 'paid', 1200, 'completed')`,
  ).bind(CODE, PHONE, DOB).run();
  const bookingId = Number(booking.meta.last_row_id);
  await db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, number, status, findings, conclusion, version, updated_by)
     VALUES (1, ?, 'PR-OTP', 'ready', 'Клінічний опис', 'Клінічний висновок', 1, 'doctor@example.com')`,
  ).bind(bookingId).run();
  await db.prepare(
    `UPDATE protocols SET status='signed', version=2, signed_by='doctor@example.com',
      signed_at=CURRENT_TIMESTAMP, signed_version=2, updated_by='doctor@example.com'
     WHERE organization_id=1 AND booking_id=? AND status='ready'`,
  ).bind(bookingId).run();
  await db.prepare(
    "UPDATE protocols SET status='issued' WHERE organization_id=1 AND booking_id=? AND status='signed'",
  ).bind(bookingId).run();
}

test("phone+DOB session lists bookings but cannot read an issued protocol before OTP", async () => {
  await withD1(async (db) => {
    await seedIssuedProtocol(db);
    const login = await callWorker(jsonRequest("/api/patient-login", { phone: "+380501112233", dob: DOB }), db);
    assert.equal(login.status, 200);
    const knowledgeCookie = (login.headers.get("set-cookie") || "").split(";")[0];

    const list = await callWorker(jsonRequest("/api/my-bookings", {}, { headers: { cookie: knowledgeCookie } }), db);
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(listBody.protocolRequiresOtp, true);
    assert.equal(listBody.bookings[0].code, CODE);
    assert.equal(listBody.bookings[0].hasProtocol, true);

    const blocked = await callWorker(jsonRequest("/api/my-protocol", { code: CODE }, { headers: { cookie: knowledgeCookie } }), db);
    assert.equal(blocked.status, 403);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.requiresOtp, true);
    assert.doesNotMatch(JSON.stringify(blockedBody), /Клінічний опис|Клінічний висновок/);

    const otpCookie = await seedPatientSession(db, PHONE, 1, { kind: "dob", value: DOB }, "", "otp");
    const allowed = await callWorker(jsonRequest("/api/my-protocol", { code: CODE }, { headers: { cookie: otpCookie } }), db);
    assert.equal(allowed.status, 200);
    const allowedBody = await allowed.json();
    assert.equal(allowedBody.protocol.conclusion, "Клінічний висновок");

    const otpList = await callWorker(jsonRequest("/api/my-bookings", {}, { headers: { cookie: otpCookie } }), db);
    assert.equal((await otpList.json()).protocolRequiresOtp, false);
  });
});
