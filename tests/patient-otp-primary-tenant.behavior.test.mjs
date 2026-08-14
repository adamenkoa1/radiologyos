import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, withD1 } from "./helpers/d1.mjs";

async function setGlobalSms(db) {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('sms_gateway_url', 'https://gateway.example/sms')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run();
}

async function addOrg2Booking(db, phone) {
  await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'otp-two', 'OTP Two', 1)").run();
  await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service, service_code,
       desired_date, desired_time, status, date_of_birth, patient_category)
     VALUES (2, 'OTP-ORG2', 'Org2 Patient', ?, ?, 'КТ', 'CT-01',
       '2026-09-01', '10:00', 'confirmed', '1990-05-05', 'civilian')`
  ).bind(`+${phone}`, phone).run();
}

test("secondary tenant OTP request returns an opaque fake challenge and never creates a usable row", async () => {
  await withD1(async (db) => {
    const phone = "380505556677";
    await addOrg2Booking(db, phone);
    await setGlobalSms(db);

    const response = await callWorker(
      jsonRequest(
        "/api/patient-otp",
        { phone:`+${phone}`, dob:"1990-05-05" },
        { ip:"203.0.113.21" },
      ),
      db,
    );
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.match(body.challengeId, /^[a-f0-9]{64}$/);
    assert.equal(body.expiresIn, 300);
    assert.match(body.message, /Якщо дані збігаються/);

    const rows = await db.prepare(
      "SELECT COUNT(*) AS n FROM patient_otp_challenges WHERE organization_id = 2 AND phone_normalized = ?"
    ).bind(phone).first("n");
    assert.equal(rows, 0);
  });
});

test("secondary tenant and unknown identity use the same neutral OTP response shape", async () => {
  await withD1(async (db) => {
    const knownPhone = "380506667788";
    await addOrg2Booking(db, knownPhone);
    await setGlobalSms(db);

    const known = await callWorker(
      jsonRequest(
        "/api/patient-otp",
        { phone:`+${knownPhone}`, dob:"1990-05-05" },
        { ip:"203.0.113.22" },
      ),
      db,
    );
    const unknown = await callWorker(
      jsonRequest(
        "/api/patient-otp",
        { phone:"+380507778899", dob:"1990-05-05" },
        { ip:"203.0.113.23" },
      ),
      db,
    );
    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    const knownBody = await known.json();
    const unknownBody = await unknown.json();
    assert.deepEqual(
      { ok:knownBody.ok, expiresIn:knownBody.expiresIn, message:knownBody.message },
      { ok:unknownBody.ok, expiresIn:unknownBody.expiresIn, message:unknownBody.message },
    );
    assert.match(knownBody.challengeId, /^[a-f0-9]{64}$/);
    assert.match(unknownBody.challengeId, /^[a-f0-9]{64}$/);
  });
});

test("OTP source checks primary tenant only after identity proof and shares opaque response with unknown identities", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/patient-otp/route.ts", import.meta.url), "utf8");
  assert.match(source, /PRIMARY_ORGANIZATION_ID = 1/);
  assert.match(source, /!proof \|\| proof\.organizationId !== PRIMARY_ORGANIZATION_ID/);
  assert.match(source, /return opaqueChallengeResponse\(\)/);
  assert.match(source, /createPatientOtpChallenge\([\s\S]*proof\.organizationId/);
});
