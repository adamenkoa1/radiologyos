import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

async function addBooking(db, {
  id,
  organizationId = 1,
  code,
  phone = "+380971110100",
  phoneNormalized = "380971110100",
  dob = "1990-01-01",
  patientId = "",
  time,
  performedAt = "",
  radiologist = "",
}) {
  await db.prepare(
    `INSERT INTO bookings (
      id, organization_id, code, name, phone, phone_normalized, patient_id, service, service_code,
      equipment_id, duration_minutes, desired_date, desired_time, status, date_of_birth,
      patient_category, performed_at, assigned_radiologist_email
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, organizationId, code, `Patient ${code}`, phone, phoneNormalized, patientId, "КТ", "CT-01",
    "ct", 30, "2026-09-04", time, performedAt ? "completed" : "confirmed", dob,
    "civilian", performedAt, radiologist,
  ).run();
}

async function addProfile(db, organizationId, patientId, phone, name) {
  await db.prepare(
    `INSERT INTO patient_profiles
      (patient_id, organization_id, phone_normalized, display_name, birth_date, birth_year, updated_by)
     VALUES (?, ?, ?, ?, '1990-01-01', 1990, 'seed')`,
  ).bind(patientId, organizationId, phone, name).run();
}

function draftRequest(db, cookie, bookingId) {
  return callWorker(jsonRequest("/api/staff/ai/protocol-draft", {
    bookingId,
    templateKey:"ct_chest",
    method:"",
    sections:{},
    findings:"",
    conclusion:"",
    recommendations:"",
    number:"",
  }, { method:"POST", headers:{ cookie } }), db);
}

test("AI prior-study context uses tenant + immutable patient_id, not shared phone or DOB", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2,'ai-other','AI Other',1)").run();
    const email = "ai-rad@likarnya.test";
    const patientId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const otherPatientId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await addProfile(db, 1, patientId, "380971110100", "Exact AI Patient");
    await addProfile(db, 1, otherPatientId, "380971110100", "Shared Phone Twin");
    await addProfile(db, 2, "cccccccccccccccccccccccccccccccc", "380971110100", "Other Tenant");

    await addBooking(db, { id:941, code:"RD-AI941", patientId, time:"09:00", radiologist:email });
    await addBooking(db, { id:942, code:"RD-AI942", patientId, time:"10:00", performedAt:"2026-08-01T10:00:00" });
    await addBooking(db, { id:943, code:"RD-AI943", patientId:otherPatientId, time:"11:00", performedAt:"2026-08-02T10:00:00" });
    await addBooking(db, { id:944, organizationId:2, code:"RD-AI944", patientId:"cccccccccccccccccccccccccccccccc", time:"12:00", performedAt:"2026-08-03T10:00:00" });

    const cookie = await seedStaffSession(db, { email, role:"radiologist", organizationId:1 });
    const response = await draftRequest(db, cookie, 941);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.draft.engine, "heuristic");
    assert.match(data.draft.recommendations, /попередніми дослідженнями пацієнта \(1\)/i);
    assert.doesNotMatch(data.draft.recommendations, /\(2\)|\(3\)/);
  });
});

test("AI prior-study context fails closed for an unlinked legacy booking", async () => {
  await withD1(async (db) => {
    const email = "ai-rad-legacy@likarnya.test";
    const phone = "+380971110200";
    const phoneNormalized = "380971110200";
    await addBooking(db, { id:951, code:"RD-AI951", phone, phoneNormalized, time:"13:00", radiologist:email });
    await addBooking(db, { id:952, code:"RD-AI952", phone, phoneNormalized, time:"14:00", performedAt:"2026-08-04T10:00:00" });

    const cookie = await seedStaffSession(db, { email, role:"radiologist", organizationId:1 });
    const response = await draftRequest(db, cookie, 951);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.doesNotMatch(data.draft.recommendations, /попередніми дослідженнями/i);
  });
});
