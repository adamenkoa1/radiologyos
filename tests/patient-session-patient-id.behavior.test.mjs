import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { callWorker, jsonRequest, withD1 } from "./helpers/d1.mjs";
import {
  createPatientOtpChallenge,
  createPatientSession,
  requirePatientSession,
  verifyPatientOtpChallenge,
} from "../lib/patient-auth.ts";
import { provePatientIdentity } from "../app/api/patient-otp/route.ts";

const PHONE = "380971112233";
const OTHER_PHONE = "380975556677";
const DOB = "1990-05-05";
const PID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_PID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const IDENTITY = { kind:"dob", value:DOB };

async function seedProfile(db, patientId = PID, phone = PHONE) {
  await db.prepare(
    `INSERT INTO patient_profiles
      (patient_id, organization_id, phone_normalized, display_name, birth_date, birth_year, updated_by)
     VALUES (?, 1, ?, 'Exact Patient', ?, 1990, 'test')`
  ).bind(patientId, phone, DOB).run();
}

async function seedBooking(db, {
  code,
  phone = PHONE,
  dob = DOB,
  patientId = "",
  time = "10:00",
} = {}) {
  await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, patient_id, date_of_birth,
       service, service_code, desired_date, desired_time, status, patient_category)
     VALUES (1, ?, 'Portal Patient', ?, ?, ?, ?, 'КТ', 'CT-01',
       '2026-09-01', ?, 'confirmed', 'civilian')`
  ).bind(code, `+${phone}`, phone, patientId, dob, time).run();
}

function requestWithCookie(path, cookie, body) {
  return jsonRequest(path, body, { headers:{ cookie } });
}

test("DOB proof upgrades to patient_id only when every matching booking resolves to one exact current profile", async () => {
  await withD1(async (db) => {
    await seedProfile(db);
    await seedBooking(db, { code:"RD-EXACT001", patientId:PID, time:"10:00" });
    await seedBooking(db, { code:"RD-EXACT002", patientId:PID, time:"10:30" });

    const exact = await provePatientIdentity(db, PHONE, { dob:DOB });
    assert.deepEqual(exact, {
      organizationId:1,
      identity:IDENTITY,
      patientId:PID,
    });

    await seedBooking(db, { code:"RD-LEGACY01", patientId:"", time:"11:00" });
    assert.equal(
      await provePatientIdentity(db, PHONE, { dob:DOB }),
      null,
      "mixed linked/unlinked DOB scope must fail closed instead of guessing identity",
    );
  });
});

test("fully legacy DOB proof remains compatible without inventing a patient link", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { code:"RD-LEGACY02" });
    assert.deepEqual(await provePatientIdentity(db, PHONE, { dob:DOB }), {
      organizationId:1,
      identity:IDENTITY,
      patientId:"",
    });
  });
});

test("OTP challenge and session carry an immutable exact patient id", async () => {
  await withD1(async (db) => {
    await seedProfile(db);
    await seedBooking(db, { code:"RD-EXACT003", patientId:PID });

    const challenge = await createPatientOtpChallenge(db, PHONE, 1, IDENTITY, "cabinet_login", PID);
    const stored = await db.prepare(
      "SELECT patient_id AS patientId FROM patient_otp_challenges WHERE id = ?"
    ).bind(challenge.challengeId).first();
    assert.equal(stored.patientId, PID);

    const verified = await verifyPatientOtpChallenge(db, {
      challengeId:challenge.challengeId,
      phoneNormalized:PHONE,
      code:challenge.code,
    });
    assert.deepEqual(verified, { organizationId:1, identity:IDENTITY, patientId:PID });

    const raw = await createPatientSession(db, PHONE, 1, IDENTITY, PID);
    const session = await requirePatientSession(new Request("https://radiologyos.tech/api/my-bookings", {
      headers:{ cookie:`rid_patient=${raw}` },
    }), db);
    assert.equal(session.patientId, PID);

    await assert.rejects(
      db.prepare("UPDATE patient_sessions SET patient_id = ? WHERE patient_id = ?").bind(OTHER_PID, PID).run(),
      /immutable/i,
    );
  });
});

test("exact patient session returns every explicitly linked booking and excludes same-phone legacy rows", async () => {
  await withD1(async (db) => {
    await seedProfile(db);
    await seedBooking(db, { code:"RD-EXACT004", patientId:PID, time:"10:00" });
    await seedBooking(db, { code:"RD-EXACT005", patientId:PID, phone:OTHER_PHONE, dob:"1988-01-01", time:"10:30" });
    await seedBooking(db, { code:"RD-LEGACY03", patientId:"", time:"11:00" });

    const exactRaw = await createPatientSession(db, PHONE, 1, IDENTITY, PID);
    const exact = await callWorker(
      requestWithCookie("/api/my-bookings", `rid_patient=${exactRaw}`),
      db,
    );
    assert.equal(exact.status, 200);
    const exactBody = await exact.json();
    assert.deepEqual(
      exactBody.bookings.map((b) => b.code).sort(),
      ["RD-EXACT004", "RD-EXACT005"],
    );

    const legacyRaw = await createPatientSession(db, PHONE, 1, IDENTITY);
    const legacy = await callWorker(
      requestWithCookie("/api/my-bookings", `rid_patient=${legacyRaw}`),
      db,
    );
    assert.equal(legacy.status, 200);
    const legacyBody = await legacy.json();
    assert.deepEqual(
      legacyBody.bookings.map((b) => b.code).sort(),
      ["RD-EXACT004", "RD-LEGACY03"],
      "patient_id='' keeps the pre-existing phone+DOB portal behavior",
    );
  });
});

test("D1 rejects an exact patient id that is not backed by the authenticated booking scope", async () => {
  await withD1(async (db) => {
    await seedProfile(db);
    await seedProfile(db, OTHER_PID, OTHER_PHONE);
    await seedBooking(db, { code:"RD-EXACT006", patientId:PID });

    const raw = "c".repeat(64);
    const tokenHash = createHash("sha256").update(raw, "utf8").digest("hex");
    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_sessions
          (token_hash, phone_normalized, organization_id, identity_kind, identity_value, patient_id, expires_at)
         VALUES (?, ?, 1, 'dob', ?, ?, datetime('now', '+30 minutes'))`
      ).bind(tokenHash, PHONE, DOB, OTHER_PID).run(),
      /patient link invalid/i,
    );
  });
});
