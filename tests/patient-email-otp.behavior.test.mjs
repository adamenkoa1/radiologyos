// Email-delivered patient OTP: a possession factor without an SMS budget.
//
// The OTP challenge/verify machinery is covered in patient-otp.behavior.test.mjs.
// This file covers the delivery-channel decision the /api/patient-otp POST makes
// and its enumeration-safety, exercised through the built worker. Delivery to a
// live gateway is intentionally NOT hit: a non-allowlisted gateway URL is refused
// by safeOutboundUrl *before* any network call, so "the email channel was chosen"
// is observable (a challenge row is created then consumed) with zero network.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker } from "./helpers/d1.mjs";

const PHONE = "+380631234567";
const PHONE_N = "380631234567";
const CODE = "RD-EMAILOTP01";

async function seedBooking(db, { email = "", code = CODE, time = "10:00" } = {}) {
  await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, date_of_birth,
       patient_email, service, service_code, desired_date, desired_time)
     VALUES (1, ?, 'Пацієнт', ?, ?, '1990-05-05', ?, 'КТ', '403', '2026-09-12', ?)`,
  ).bind(code, PHONE, PHONE_N, email, time).run();
}

async function setEmailGateway(db, url) {
  await db.prepare(
    `INSERT INTO organization_integration_settings (organization_id, key, value, updated_at)
     VALUES (1, 'email_gateway_url', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id, key) DO UPDATE SET value = excluded.value`,
  ).bind(url).run();
}

const requestOtp = (db, body) =>
  callWorker(jsonRequest("/api/patient-otp", body, { ip: "198.51.100.61" }), db);

const challengeCount = (db) =>
  db.prepare("SELECT COUNT(*) AS n FROM patient_otp_challenges").first("n");

test("with no delivery channel configured the OTP request fails closed before identity lookup", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { email: "patient@example.com" });
    const res = await requestOtp(db, { phone: PHONE, bookingCode: CODE });
    assert.equal(res.status, 503);
    assert.equal(await challengeCount(db), 0, "no challenge is minted when nothing can deliver it");
  });
});

test("a proven identity with an email on file selects the email channel", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { email: "patient@example.com" });
    // Gateway host is deliberately NOT allowlisted: safeOutboundUrl refuses it
    // before any fetch, so the send fails locally — but only *after* the route
    // has decided on the email channel and created the challenge.
    await setEmailGateway(db, "https://mail.example.test/send");

    const res = await requestOtp(db, { phone: PHONE, bookingCode: CODE });
    // Delivery failure surfaces as 503, and the undelivered code is invalidated.
    assert.equal(res.status, 503);
    const row = await db.prepare(
      "SELECT consumed_at AS consumedAt FROM patient_otp_challenges WHERE phone_normalized = ? LIMIT 1",
    ).bind(PHONE_N).first();
    assert.ok(row, "email channel was chosen, so a challenge row was created");
    assert.notEqual(row.consumedAt, "", "an undelivered code must be consumed so it cannot be used");
  });
});

test("a proven identity with no email on file and no SMS returns an opaque response and mints no challenge", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { email: "" });
    await setEmailGateway(db, "https://mail.example.test/send");

    const res = await requestOtp(db, { phone: PHONE, bookingCode: CODE });
    // Indistinguishable from an unknown identity: opaque 202, and crucially no
    // challenge row — "does this patient have an email on file" never leaks.
    assert.equal(res.status, 202);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(await challengeCount(db), 0);
  });
});

test("an unknown identity is opaque and mints no challenge even with a gateway up", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { email: "patient@example.com" });
    await setEmailGateway(db, "https://mail.example.test/send");

    const res = await requestOtp(db, { phone: PHONE, bookingCode: "RD-WRONGCODE9" });
    assert.equal(res.status, 202);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(await challengeCount(db), 0);
  });
});
