import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const PACS_ENV = { OUTBOUND_ALLOWED_HOSTS: "pacs.example.com" };
const UID_A = "1.2.840.113619.2.55.3.700001";
const UID_B = "1.2.840.113619.2.55.3.700002";

async function addBooking(db, code, time) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id,
       desired_date, desired_time, status, performed_at)
     VALUES (1, ?, 'Signed DICOM Patient', '+380501110066', '380501110066',
       'КТ ОГК', '403', 'ct', '2026-08-20', ?, 'completed', '2026-08-20T10:30:00')`,
  ).bind(code, time).run();
  return Number(result.meta.last_row_id);
}

async function addStudy(db, bookingId, code, uid = UID_A) {
  await db.prepare(
    `INSERT INTO imaging_studies
      (organization_id, booking_id, accession_number, study_instance_uid, modality,
       series_count, instances_count, study_status, study_datetime, source, updated_by)
     VALUES (1, ?, ?, ?, 'CT', 2, 20, 'available', '2026-08-20T10:30:15',
       'qido_accession', 'seed@example.com')`,
  ).bind(bookingId, code, uid).run();
}

async function signProtocol(db, bookingId, number) {
  await db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, number, status, version, author_email, updated_by,
       findings, conclusion)
     VALUES (1, ?, ?, 'ready', 1, 'doctor@example.com', 'doctor@example.com',
       'Опис дослідження.', 'КТ-ознаки без гострої патології.')`,
  ).bind(bookingId, number).run();
  await db.prepare(
    `UPDATE protocols
     SET status='signed', version=2, signed_by='doctor@example.com',
         signed_at=CURRENT_TIMESTAMP, signed_version=2, updated_by='doctor@example.com'
     WHERE organization_id=1 AND booking_id=?`,
  ).bind(bookingId).run();
}

function qidoStudy(accession, uid) {
  return {
    "00080020": { vr:"DA", Value:["20260820"] },
    "00080030": { vr:"TM", Value:["103015"] },
    "00080050": { vr:"SH", Value:[accession] },
    "00080061": { vr:"CS", Value:["CT"] },
    "0020000D": { vr:"UI", Value:[uid] },
  };
}

async function configurePacs(db) {
  await db.prepare(
    `UPDATE pacs_settings
     SET dicomweb_base_url='https://pacs.example.com/dicom-web',
         viewer_base_url='https://viewer.example.com/viewer', ae_title='RADTEST', enabled=1
     WHERE organization_id=1`,
  ).run();
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

test("D1 freezes DICOM clinical identity after protocol signing but allows operational refresh", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db, "SIGNED-DICOM-1", "10:00");
    await addStudy(db, bookingId, "SIGNED-DICOM-1", UID_A);
    await signProtocol(db, bookingId, "P-SIGNED-DICOM-1");

    for (const [sql, value] of [
      ["UPDATE imaging_studies SET study_instance_uid=? WHERE organization_id=1 AND booking_id=?", UID_B],
      ["UPDATE imaging_studies SET accession_number=? WHERE organization_id=1 AND booking_id=?", "OTHER-ACCESSION"],
      ["UPDATE imaging_studies SET modality=? WHERE organization_id=1 AND booking_id=?", "DX"],
      ["UPDATE imaging_studies SET study_datetime=? WHERE organization_id=1 AND booking_id=?", "2026-08-20T11:00:00"],
    ]) {
      await assert.rejects(
        db.prepare(sql).bind(value, bookingId).run(),
        /signed protocol imaging identity is immutable/i,
      );
    }

    await assert.rejects(
      db.prepare("DELETE FROM imaging_studies WHERE organization_id=1 AND booking_id=?").bind(bookingId).run(),
      /signed protocol imaging identity is immutable/i,
    );

    await db.prepare(
      `UPDATE imaging_studies
       SET series_count=3, instances_count=42, study_status='archived',
           source='qido_uid_manual', updated_by='refresh@example.com', updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=1 AND booking_id=?`,
    ).bind(bookingId).run();

    const stored = await db.prepare(
      `SELECT accession_number AS accessionNumber, study_instance_uid AS uid, modality,
              study_datetime AS studyDatetime, series_count AS seriesCount,
              instances_count AS instancesCount, study_status AS studyStatus, source
       FROM imaging_studies WHERE organization_id=1 AND booking_id=?`,
    ).bind(bookingId).first();
    assert.equal(stored.accessionNumber, "SIGNED-DICOM-1");
    assert.equal(stored.uid, UID_A);
    assert.equal(stored.modality, "CT");
    assert.equal(stored.studyDatetime, "2026-08-20T10:30:15");
    assert.equal(stored.seriesCount, 3);
    assert.equal(stored.instancesCount, 42);
    assert.equal(stored.studyStatus, "archived");
    assert.equal(stored.source, "qido_uid_manual");

    await db.prepare("UPDATE protocols SET status='issued', updated_by='registrar@example.com' WHERE organization_id=1 AND booking_id=?")
      .bind(bookingId).run();
    await assert.rejects(
      db.prepare("UPDATE imaging_studies SET study_instance_uid=? WHERE organization_id=1 AND booking_id=?")
        .bind(UID_B, bookingId).run(),
      /signed protocol imaging identity is immutable/i,
    );
  });
});

test("D1 rejects creating the first imaging link after a protocol is already signed", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db, "SIGNED-DICOM-2", "11:00");
    await signProtocol(db, bookingId, "P-SIGNED-DICOM-2");
    await assert.rejects(
      addStudy(db, bookingId, "SIGNED-DICOM-2", UID_A),
      /signed protocol imaging identity is immutable/i,
    );
    const count = await db.prepare(
      "SELECT COUNT(*) AS n FROM imaging_studies WHERE organization_id=1 AND booking_id=?",
    ).bind(bookingId).first("n");
    assert.equal(count, 0);
  });
});

test("imaging API returns 409 and preserves the signed StudyInstanceUID on relink", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"dicom-lock-admin@example.com", role:"admin" });
    const bookingId = await addBooking(db, "SIGNED-DICOM-API", "12:00");
    await configurePacs(db);
    await addStudy(db, bookingId, "SIGNED-DICOM-API", UID_A);
    await signProtocol(db, bookingId, "P-SIGNED-DICOM-API");

    const response = await withMockFetch(qidoStudy("SIGNED-DICOM-API", UID_B), () =>
      callWorker(jsonRequest("/api/staff/imaging", { bookingId }, {
        method:"POST", headers:{ cookie },
      }), db, PACS_ENV),
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.status, "locked");
    assert.equal(body.reason, "signed_protocol_identity_locked");

    const storedUid = await db.prepare(
      "SELECT study_instance_uid AS uid FROM imaging_studies WHERE organization_id=1 AND booking_id=?",
    ).bind(bookingId).first("uid");
    assert.equal(storedUid, UID_A);

    const event = await db.prepare(
      `SELECT action, details FROM booking_events
       WHERE organization_id=1 AND booking_id=? ORDER BY id DESC LIMIT 1`,
    ).bind(bookingId).first();
    assert.equal(event.action, "imaging_relink_rejected");
    assert.match(event.details, /signed_protocol_identity_locked/);
    assert.doesNotMatch(event.details, /1\.2\.840/);
  });
});
