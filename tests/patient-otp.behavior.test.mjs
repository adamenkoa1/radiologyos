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

test("OTP is six digits, stored only as a PBKDF2 hash, and verifies once", async () => {
  await withD1(async (db) => {
    const challenge = await createPatientOtpChallenge(db, "380971112233", 1);
    assert.match(challenge.code, /^\d{6}$/);
    assert.equal(challenge.expiresIn, 300);

    const row = await db.prepare(
      "SELECT code_hash AS codeHash, consumed_at AS consumedAt FROM patient_otp_challenges WHERE id = ?",
    ).bind(challenge.challengeId).first();
    assert.match(row.codeHash, /^pbkdf2\$sha256\$/);
    assert.ok(!row.codeHash.includes(challenge.code));
    assert.equal(row.consumedAt, "");

    const verified = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: "380971112233",
      code: challenge.code,
    });
    assert.deepEqual(verified, { organizationId: 1 });

    const replay = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: "380971112233",
      code: challenge.code,
    });
    assert.equal(replay, null);
  });
});

test("wrong OTP increments attempts and cannot be used across phone identities", async () => {
  await withD1(async (db) => {
    const challenge = await createPatientOtpChallenge(db, "380971112233", 1);
    const wrongPhone = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: "380975556677",
      code: challenge.code,
    });
    assert.equal(wrongPhone, null);

    const wrong = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: "380971112233",
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
    const challenge = await createPatientOtpChallenge(db, "380971112233", 1);
    await db.prepare(
      "UPDATE patient_otp_challenges SET expires_at = datetime('now', '-1 second') WHERE id = ?",
    ).bind(challenge.challengeId).run();
    const verified = await verifyPatientOtpChallenge(db, {
      challengeId: challenge.challengeId,
      phoneNormalized: "380971112233",
      code: challenge.code,
    });
    assert.equal(verified, null);
  });
});

test("creating a newer OTP invalidates the older active challenge", async () => {
  await withD1(async (db) => {
    const first = await createPatientOtpChallenge(db, "380971112233", 1);
    const second = await createPatientOtpChallenge(db, "380971112233", 1);
    const stale = await verifyPatientOtpChallenge(db, {
      challengeId: first.challengeId,
      phoneNormalized: "380971112233",
      code: first.code,
    });
    assert.equal(stale, null);
    const current = await verifyPatientOtpChallenge(db, {
      challengeId: second.challengeId,
      phoneNormalized: "380971112233",
      code: second.code,
    });
    assert.deepEqual(current, { organizationId: 1 });
  });
});

test("patient sessions carry explicit tenant scope", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Інша', 1)").run();
    const raw = await createPatientSession(db, "380971112233", 2);
    const request = new Request("https://radiologyos.tech/api/my-bookings", {
      headers: { cookie: `rid_patient=${raw}` },
    });
    const session = await requirePatientSession(request, db);
    assert.equal(session.phoneNormalized, "380971112233");
    assert.equal(session.organizationId, 2);
  });
});

test("OTP normalizer accepts only six digits", () => {
  assert.equal(normalizeOtp("123456"), "123456");
  assert.equal(normalizeOtp(" 123456 "), "123456");
  assert.equal(normalizeOtp("12345"), "");
  assert.equal(normalizeOtp("1234567"), "");
  assert.equal(normalizeOtp("12a456"), "");
});
