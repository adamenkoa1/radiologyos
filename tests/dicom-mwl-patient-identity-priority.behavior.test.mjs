import assert from "node:assert/strict";
import test from "node:test";
import { mwlIdentityKey } from "../lib/mwl-bridge.ts";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const PACS_ENV = { OUTBOUND_ALLOWED_HOSTS: "pacs.example.com" };
const PHONE = "380501110055";
const EXPECTED_DICOM_ID = "ROS-AAAAAAAAAAAAAAAAAAAA";
const WRONG_DICOM_ID = "ROS-BBBBBBBBBBBBBBBBBBBB";

async function configurePacs(db) {
  await db.prepare(
    `UPDATE pacs_settings
     SET dicomweb_base_url='https://pacs.example.com/dicom-web',
         viewer_base_url='https://viewer.example.com/viewer', ae_title='RADTEST', enabled=1
     WHERE organization_id=1`,
  ).run();
}

async function addBooking(db, { code, time, patientId = "" }) {
  if (patientId) {
    await db.prepare(
      `INSERT INTO patient_profiles
        (patient_id, organization_id, phone_normalized, display_name, updated_by)
       VALUES (?, 1, ?, ?, 'test')`,
    ).bind(patientId, PHONE, `Пацієнт ${code}`).run();
  }
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, patient_id,
       service, service_code, equipment_id, desired_date, desired_time, status)
     VALUES (1, ?, ?, ?, ?, ?,
       'КТ ОГК', '403', 'ct', '2026-08-20', ?, 'confirmed')`,
  ).bind(code, `Пацієнт ${code}`, `+${PHONE}`, PHONE, patientId, time).run();
  return Number(result.meta.last_row_id);
}

async function addMwlIdentity(db, patientId, dicomPatientId = EXPECTED_DICOM_ID) {
  await db.prepare(
    `INSERT INTO mwl_patient_ids (organization_id, identity_key, patient_id)
     VALUES (1, ?, ?)`,
  ).bind(mwlIdentityKey(patientId, ""), dicomPatientId).run();
}

function qidoStudy({ accession, uid, patientId }) {
  const row = {
    "00080020": { vr:"DA", Value:["20260820"] },
    "00080030": { vr:"TM", Value:["103000"] },
    "00080050": { vr:"SH", Value:[accession] },
    "00080061": { vr:"CS", Value:["CT"] },
    "0020000D": { vr:"UI", Value:[uid] },
  };
  if (patientId !== undefined) row["00100020"] = { vr:"LO", Value:[patientId] };
  return row;
}

async function withMockFetch(study, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/studies?")) {
      return Response.json([study], { headers:{ "content-type":"application/dicom+json" } });
    }
    if (url.includes("/series")) {
      return Response.json([], { headers:{ "content-type":"application/dicom+json" } });
    }
    return new Response("not found", { status:404 });
  };
  try { return await fn(); } finally { globalThis.fetch = previous; }
}

async function autoLink(db, cookie, bookingId, study) {
  return withMockFetch(study, () =>
    callWorker(jsonRequest("/api/staff/imaging", { bookingId }, {
      method:"POST", headers:{ cookie },
    }), db, PACS_ENV),
  );
}

test("canonical accession still requires matching PACS PatientID when immutable MWL identity exists", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"mwl-priority-admin@example.com", role:"admin" });
    await configurePacs(db);
    const patientId = "PAT-MWL-PRIORITY-1";
    const bookingId = await addBooking(db, { code:"MWL-PRIORITY-1", time:"10:00", patientId });
    await addMwlIdentity(db, patientId);

    const mismatch = await autoLink(db, cookie, bookingId, qidoStudy({
      accession:"MWL-PRIORITY-1",
      uid:"1.2.840.113619.2.55.3.710001",
      patientId:WRONG_DICOM_ID,
    }));
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).reason, "patient_id_mismatch");

    const missing = await autoLink(db, cookie, bookingId, qidoStudy({
      accession:"MWL-PRIORITY-1",
      uid:"1.2.840.113619.2.55.3.710002",
      patientId:undefined,
    }));
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).reason, "patient_id_missing");

    const storedBeforeMatch = await db.prepare(
      "SELECT COUNT(*) AS n FROM imaging_studies WHERE organization_id=1 AND booking_id=?",
    ).bind(bookingId).first("n");
    assert.equal(storedBeforeMatch, 0);

    const matching = await autoLink(db, cookie, bookingId, qidoStudy({
      accession:"MWL-PRIORITY-1",
      uid:"1.2.840.113619.2.55.3.710003",
      patientId:EXPECTED_DICOM_ID,
    }));
    assert.equal(matching.status, 200);
    const body = await matching.json();
    assert.equal(body.status, "linked");
    assert.equal(body.study.studyInstanceUid, "1.2.840.113619.2.55.3.710003");

    const events = await db.prepare(
      `SELECT action, details FROM booking_events
       WHERE organization_id=1 AND booking_id=? AND action='imaging_auto_link_rejected'
       ORDER BY id`,
    ).bind(bookingId).all();
    assert.equal(events.results.length, 2);
    assert.match(events.results[0].details, /patient_id_mismatch/);
    assert.match(events.results[1].details, /patient_id_missing/);
    assert.doesNotMatch(JSON.stringify(events.results), /ROS-[A-Z0-9]+/);
  });
});

test("canonical accession-only fallback remains available for true legacy booking without MWL identity", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"mwl-legacy-admin@example.com", role:"admin" });
    await configurePacs(db);
    const bookingId = await addBooking(db, { code:"MWL-LEGACY-DICOM", time:"11:00" });

    const response = await autoLink(db, cookie, bookingId, qidoStudy({
      accession:"MWL-LEGACY-DICOM",
      uid:"1.2.840.113619.2.55.3.710004",
      patientId:WRONG_DICOM_ID,
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "linked");
    assert.equal(body.study.accessionNumber, "MWL-LEGACY-DICOM");
  });
});
