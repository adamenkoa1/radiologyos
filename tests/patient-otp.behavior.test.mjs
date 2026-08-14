import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";
import {
  createPatientOtpChallenge,
  createPatientSession,
  normalizeOtp,
  requirePatientSession,
  verifyPatientOtpChallenge,
} from "../lib/patient-auth.ts";

const PHONE = "380971112233";
const DOB = "1990-05-05";
const IDENTITY = { kind:"dob", value:DOB };

async function seedIdentityBooking(db, {
  organizationId = 1,
  code = "RD-OTP00001",
  phone = PHONE,
  dob = DOB,
  time = "10:00",
} = {}) {
  await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, date_of_birth,
       service, service_code, desired_date, desired_time)
     VALUES (?, ?, 'OTP Patient', ?, ?, ?, 'КТ', '403', '2026-09-01', ?)`
  ).bind(organizationId, code, `+${phone}`, phone, dob, time).run();
}

test("OTP is six digits, stored only as a PBKDF2 hash, identity-scoped and verifies once", async () => {
  await withD1(async (db) => {
    await seedIdentityBooking(db);
    const challenge = await createPatientOtpChallenge(db, PHONE, 1, IDENTITY);
    assert.match(challenge.code, /^\d{6}$/);
    assert.equal(challenge.expiresIn, 300);

    const row = await db.prepare(
      `SELECT code_hash AS codeHash, consumed_at AS consumedAt,
        identity_kind AS identityKind, identity_value AS identityValue
       FROM patient_otp_challenges WHERE id = ?`,
    ).bind(challenge.challengeId).first();
    assert.match(row.codeHash, /^pbkdf2\$sha256\$/);
    assert.ok(!row.codeHash.includes(challenge.code));
    assert.equal(row.consumedAt, "");
    assert.equal(row.identityKind, "dob");
    assert.equal(row.identityValue, DOB);

    const verified = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: PHONE,
      code: challenge.code,
    });
    assert.deepEqual(verified, { organizationId:1, identity:IDENTITY });

    const replay = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: PHONE,
      code: challenge.code,
    });
    assert.equal(replay, null);
  });
});

test("wrong OTP increments attempts and cannot be used across phone identities", async () => {
  await withD1(async (db) => {
    await seedIdentityBooking(db);
    const challenge = await createPatientOtpChallenge(db, PHONE, 1, IDENTITY);
    const wrongPhone = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: "380975556677",
      code: challenge.code,
    });
    assert.equal(wrongPhone, null);

    const wrong = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: PHONE,
      code: challenge.code === "000000" ? "000001" : "000000",
    });
    assert.equal(wrong, null);
    const attempts = await db.prepare(
      "SELECT attempts FROM patient_otp_challenges WHERE id = ?",
    ).bind(challenge.challengeId).first("attempts");
    assert.equal(attempts, 1);
  });
});

test("expired OTP is rejected", async () => {
  await withD1(async (db) => {
    await seedIdentityBooking(db);
    const challenge = await createPatientOtpChallenge(db, PHONE, 1, IDENTITY);
    await db.prepare(
      "UPDATE patient_otp_challenges SET expires_at = datetime('now', '-1 second') WHERE id = ?",
    ).bind(challenge.challengeId).run();
    const verified = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: PHONE,
      code: challenge.code,
    });
    assert.equal(verified, null);
  });
});

test("creating a newer OTP invalidates only the older challenge for the same identity", async () => {
  await withD1(async (db) => {
    await seedIdentityBooking(db);
    await seedIdentityBooking(db, { code:"RD-OTP00002", dob:"1980-01-01", time:"10:30" });
    const otherIdentity = { kind:"dob", value:"1980-01-01" };
    const first = await createPatientOtpChallenge(db, PHONE, 1, IDENTITY);
    const family = await createPatientOtpChallenge(db, PHONE, 1, otherIdentity);
    const second = await createPatientOtpChallenge(db, PHONE, 1, IDENTITY);

    const stale = await verifyPatientOtpChallenge(db, {
      challengeId: first.challengeId,
      phoneNormalized: PHONE,
      code: first.code,
    });
    assert.equal(stale, null);

    const familyVerified = await verifyPatientOtpChallenge(db, {
      challengeId: family.challengeId,
      phoneNormalized: PHONE,
      code: family.code,
    });
    assert.deepEqual(familyVerified, { organizationId:1, identity:otherIdentity });

    const current = await verifyPatientOtpChallenge(db, {
      challengeId: second.challengeId,
      phoneNormalized: PHONE,
      code: second.code,
    });
    assert.deepEqual(current, { organizationId:1, identity:IDENTITY });
  });
});

test("patient sessions carry explicit tenant and patient identity scope", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Інша', 1)").run();
    await seedIdentityBooking(db, { organizationId:2, code:"RD-OTPORG002" });
    const raw = await createPatientSession(db, PHONE, 2, IDENTITY);
    const request = new Request("https://radiologyos.tech/api/my-bookings", {
      headers: { cookie: `rid_patient=${raw}` },
    });
    const session = await requirePatientSession(request, db);
    assert.equal(session.phoneNormalized, PHONE);
    assert.equal(session.organizationId, 2);
    assert.equal(session.identityKind, "dob");
    assert.equal(session.identityValue, DOB);
  });
});

test("D1 rejects patient auth scopes that do not correspond to a real booking identity", async () => {
  await withD1(async (db) => {
    await seedIdentityBooking(db);
    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_sessions
          (token_hash, phone_normalized, organization_id, identity_kind, identity_value, expires_at)
         VALUES ('bad-session', ?, 1, 'dob', '1977-07-07', datetime('now', '+1 hour'))`
      ).bind(PHONE).run(),
      /identity scope invalid/i,
    );
    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_otp_challenges
          (id, organization_id, phone_normalized, identity_kind, identity_value, code_hash, expires_at)
         VALUES ('bad-otp', 1, ?, 'booking', 'RD-NOTREAL1', 'hash', datetime('now', '+5 minutes'))`
      ).bind(PHONE).run(),
      /identity scope invalid/i,
    );
  });
});

test("OTP normalizer accepts only six digits", () => {
  assert.equal(normalizeOtp("123456"), "123456");
  assert.equal(normalizeOtp(" 123456 "), "123456");
  assert.equal(normalizeOtp("12345"), "");
  assert.equal(normalizeOtp("1234567"), "");
  assert.equal(normalizeOtp("12a456"), "");
});
