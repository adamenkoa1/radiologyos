import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function issueToken(db) {
  const email = "mwl-identity-admin@example.com";
  const cookie = await seedStaffSession(db, { email, role:"admin", withMembership:false });
  await db.prepare(
    `INSERT INTO memberships (organization_id, member_email, role, active)
     VALUES (1, ?, 'admin', 1)`,
  ).bind(email).run();
  const response = await callWorker(jsonRequest("/api/staff/integrations/mwl-token", {}, {
    method:"POST", headers:{ cookie },
  }), db);
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function addProfile(db, name, phone) {
  await db.prepare(
    `INSERT INTO patient_profiles
      (organization_id, phone_normalized, display_name, updated_by)
     VALUES (1, ?, ?, 'test')`,
  ).bind(phone, name).run();
  const row = await db.prepare(
    `SELECT patient_id AS patientId FROM patient_profiles
     WHERE organization_id=1 AND phone_normalized=? AND display_name=? LIMIT 1`,
  ).bind(phone, name).first();
  return row.patientId;
}

async function addBooking(db, { code, phone, patientId = "", desiredTime }) {
  await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, patient_id, date_of_birth,
       service, service_code, equipment_id, desired_date, desired_time, patient_category, status)
     VALUES (1, ?, ?, ?, ?, ?, '1990-02-03', 'КТ ОГК', '403', 'ct',
       '2026-08-20', ?, 'civilian', 'confirmed')`,
  ).bind(code, `Пацієнт ${code}`, `+${phone}`, phone, patientId, desiredTime).run();
}

async function loadMwl(db, token) {
  const response = await callWorker(jsonRequest(
    "/api/integrations/mwl?from=2026-08-20&to=2026-08-20", undefined,
    { method:"GET", headers:{ authorization:`Bearer ${token}` } },
  ), db);
  assert.equal(response.status, 200);
  return response.json();
}

test("MWL PatientID follows immutable patient identity and never shared phone", async () => {
  await withD1(async (db) => {
    const token = await issueToken(db);
    const sharedPhone = "380501112233";
    const patientA = await addProfile(db, "Пацієнт A", sharedPhone);
    const patientB = await addProfile(db, "Пацієнт B", sharedPhone);

    // A historical phone-key mapping may exist from the pre-shared-phone model.
    // It must never be reused for exact or new legacy MWL identity resolution.
    const historicalPhoneDicomId = "ROS-AAAAAAAAAAAAAAAAAAAA";
    await db.prepare(
      `INSERT INTO mwl_patient_ids (organization_id, identity_key, patient_id)
       VALUES (1, ?, ?)`,
    ).bind(`phone:${sharedPhone}`, historicalPhoneDicomId).run();

    await addBooking(db, { code:"MWL-A-1", phone:sharedPhone, patientId:patientA, desiredTime:"08:00" });
    await addBooking(db, { code:"MWL-B-1", phone:sharedPhone, patientId:patientB, desiredTime:"09:00" });
    await addBooking(db, { code:"MWL-A-2", phone:sharedPhone, patientId:patientA, desiredTime:"10:00" });
    await addBooking(db, { code:"MWL-LEGACY-1", phone:sharedPhone, desiredTime:"11:00" });
    await addBooking(db, { code:"MWL-LEGACY-2", phone:sharedPhone, desiredTime:"12:00" });

    const body = await loadMwl(db, token);
    const byCode = new Map(body.items.map((item) => [item.scheduledProcedureStepId, item]));
    const a1 = byCode.get("MWL-A-1");
    const a2 = byCode.get("MWL-A-2");
    const b1 = byCode.get("MWL-B-1");
    const legacy1 = byCode.get("MWL-LEGACY-1");
    const legacy2 = byCode.get("MWL-LEGACY-2");

    for (const item of [a1, a2, b1, legacy1, legacy2]) assert.match(item.patientId, /^ROS-[A-F0-9]{20}$/);
    assert.equal(a1.patientId, a2.patientId, "two bookings for one exact patient must keep one DICOM PatientID");
    assert.notEqual(a1.patientId, b1.patientId, "different exact patients sharing a phone must never share DICOM PatientID");
    assert.notEqual(legacy1.patientId, legacy2.patientId, "unlinked legacy bookings must remain separate in PACS");
    assert.notEqual(a1.patientId, historicalPhoneDicomId);
    assert.notEqual(b1.patientId, historicalPhoneDicomId);
    assert.notEqual(legacy1.patientId, historicalPhoneDicomId);

    const keys = await db.prepare(
      `SELECT identity_key AS identityKey FROM mwl_patient_ids
       WHERE organization_id=1 ORDER BY identity_key`,
    ).all();
    const identityKeys = keys.results.map((row) => row.identityKey);
    assert.ok(identityKeys.includes(`patient:${patientA}`));
    assert.ok(identityKeys.includes(`patient:${patientB}`));
    assert.ok(identityKeys.includes("booking:MWL-LEGACY-1"));
    assert.ok(identityKeys.includes("booking:MWL-LEGACY-2"));
    assert.equal(identityKeys.filter((key) => key.startsWith("phone:")).length, 1, "only the seeded historical phone key may remain");
  });
});
