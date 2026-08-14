import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const PACS_ENV = { OUTBOUND_ALLOWED_HOSTS: "pacs.example.com" };

async function seedAdmin(db) {
  const email = "imaging-admin@example.com";
  const cookie = await seedStaffSession(db, { email, role: "admin", withMembership: false });
  await db.prepare(
    `INSERT INTO memberships (organization_id, member_email, role, active)
     VALUES (1, ?, 'admin', 1)`,
  ).bind(email).run();
  return cookie;
}

async function seedBooking(db, code) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, service, service_code, equipment_id,
       desired_date, desired_time, patient_category, status, performed_at)
     VALUES (1, ?, 'Пацієнт', '+380501112233', 'КТ ОГК', '403', 'ct',
       '2026-08-20', '10:00', 'civilian', 'completed', '2026-08-20T10:30:00')`,
  ).bind(code).run();
  return Number(result.meta.last_row_id);
}

async function configurePacs(db) {
  await db.prepare(
    `UPDATE pacs_settings SET dicomweb_base_url = ?, viewer_base_url = ?,
       ae_title = 'RADTEST', enabled = 1 WHERE organization_id = 1`,
  ).bind("https://pacs.example.com/dicom-web", "https://viewer.example.com/viewer").run();
}

function studyRow(accession, uid, { modality = "CT", series = 2, instances = 10 } = {}) {
  return {
    "00080020": { vr: "DA", Value: ["20260820"] },
    "00080030": { vr: "TM", Value: ["103015"] },
    "00080050": { vr: "SH", Value: [accession] },
    "00080061": { vr: "CS", Value: [modality] },
    "0020000D": { vr: "UI", Value: [uid] },
    "00201206": { vr: "IS", Value: [series] },
    "00201208": { vr: "IS", Value: [instances] },
  };
}

function seriesRow(uid, instances) {
  return {
    "0020000E": { vr: "UI", Value: [uid] },
    "00080060": { vr: "CS", Value: ["CT"] },
    "00200011": { vr: "IS", Value: ["1"] },
    "00201209": { vr: "IS", Value: [instances] },
  };
}

async function withMockFetch(handler, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = previous;
  }
}

test("a single exact accession match auto-links the PACS study", async () => {
  await withD1(async (db) => {
    const cookie = await seedAdmin(db);
    const bookingId = await seedBooking(db, "AUTO-001");
    await configurePacs(db);
    const requested = [];

    await withMockFetch(async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/studies?")) {
        return Response.json([
          studyRow("AUTO-001", "1.2.840.113619.2.55.3.604688123.1"),
        ], { headers: { "content-type": "application/dicom+json" } });
      }
      if (url.includes("/series")) {
        return Response.json([
          seriesRow("1.2.840.1.1", 4),
          seriesRow("1.2.840.1.2", 6),
        ], { headers: { "content-type": "application/dicom+json" } });
      }
      return new Response("not found", { status: 404 });
    }, async () => {
      const response = await callWorker(jsonRequest("/api/staff/imaging", { bookingId }, {
        method: "POST", headers: { cookie },
      }), db, PACS_ENV);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, "linked");
      assert.equal(body.study.accessionNumber, "AUTO-001");
      assert.equal(body.study.studyInstanceUid, "1.2.840.113619.2.55.3.604688123.1");
      assert.equal(body.study.seriesCount, 2);
      assert.equal(body.study.instancesCount, 10);
      assert.match(body.viewerUrl, /StudyInstanceUIDs=/);
    });

    assert.ok(requested.some((url) => url.includes("AccessionNumber=AUTO-001")));
    const row = await db.prepare(
      `SELECT accession_number AS accessionNumber, study_instance_uid AS studyInstanceUid,
        source, study_status AS studyStatus, series_count AS seriesCount, instances_count AS instancesCount
       FROM imaging_studies WHERE booking_id = ? AND organization_id = 1`,
    ).bind(bookingId).first();
    assert.equal(row.accessionNumber, "AUTO-001");
    assert.equal(row.studyInstanceUid, "1.2.840.113619.2.55.3.604688123.1");
    assert.equal(row.source, "qido_accession");
    assert.equal(row.studyStatus, "available");
    assert.equal(row.seriesCount, 2);
    assert.equal(row.instancesCount, 10);

    const audit = await db.prepare(
      `SELECT action FROM booking_events
       WHERE organization_id = 1 AND booking_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(bookingId).first();
    assert.equal(audit.action, "imaging_auto_linked");
  });
});

test("multiple exact accession matches are rejected without mutating the existing link", async () => {
  await withD1(async (db) => {
    const cookie = await seedAdmin(db);
    const bookingId = await seedBooking(db, "AUTO-002");
    await configurePacs(db);
    await db.prepare(
      `INSERT INTO imaging_studies
        (organization_id, booking_id, accession_number, study_status, source, updated_by)
       VALUES (1, ?, 'CUSTOM-002', 'scheduled', 'manual', 'seed')`,
    ).bind(bookingId).run();

    await withMockFetch(async () => Response.json([
      studyRow("CUSTOM-002", "1.2.840.10008.1.1"),
      studyRow("CUSTOM-002", "1.2.840.10008.1.2"),
    ]), async () => {
      const response = await callWorker(jsonRequest("/api/staff/imaging", { bookingId }, {
        method: "POST", headers: { cookie },
      }), db, PACS_ENV);
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.status, "ambiguous");
      assert.equal(body.matches, 2);
    });

    const row = await db.prepare(
      `SELECT study_instance_uid AS studyInstanceUid, source, study_status AS studyStatus
       FROM imaging_studies WHERE booking_id = ?`,
    ).bind(bookingId).first();
    assert.equal(row.studyInstanceUid, "");
    assert.equal(row.source, "manual");
    assert.equal(row.studyStatus, "scheduled");
  });
});

test("zero accession matches do not create an imaging link", async () => {
  await withD1(async (db) => {
    const cookie = await seedAdmin(db);
    const bookingId = await seedBooking(db, "AUTO-003");
    await configurePacs(db);

    await withMockFetch(async () => Response.json([]), async () => {
      const response = await callWorker(jsonRequest("/api/staff/imaging", { bookingId }, {
        method: "POST", headers: { cookie },
      }), db, PACS_ENV);
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.equal(body.status, "not_found");
    });

    const row = await db.prepare(
      "SELECT booking_id FROM imaging_studies WHERE booking_id = ?",
    ).bind(bookingId).first();
    assert.equal(row, null);
  });
});

test("manual override after auto-link resets PACS-derived metadata", async () => {
  await withD1(async (db) => {
    const cookie = await seedAdmin(db);
    const bookingId = await seedBooking(db, "AUTO-004");
    await db.prepare(
      `INSERT INTO imaging_studies
        (organization_id, booking_id, accession_number, study_instance_uid, modality,
         series_count, instances_count, study_status, source, updated_by)
       VALUES (1, ?, 'AUTO-004', '1.2.840.113619.2.4', 'CT', 5, 100, 'available', 'qido_accession', 'seed')`,
    ).bind(bookingId).run();

    const response = await callWorker(jsonRequest("/api/staff/imaging", {
      bookingId,
      accessionNumber: "MANUAL-004",
      studyInstanceUid: "1.2.840.10008.5.1",
      modality: "DX",
      studyStatus: "available",
      studyDatetime: "2026-08-20T11:00:00",
    }, { method: "PUT", headers: { cookie } }), db);
    assert.equal(response.status, 200);

    const row = await db.prepare(
      `SELECT accession_number AS accessionNumber, study_instance_uid AS studyInstanceUid,
        modality, series_count AS seriesCount, instances_count AS instancesCount, source
       FROM imaging_studies WHERE booking_id = ? AND organization_id = 1`,
    ).bind(bookingId).first();
    assert.equal(row.accessionNumber, "MANUAL-004");
    assert.equal(row.studyInstanceUid, "1.2.840.10008.5.1");
    assert.equal(row.modality, "DX");
    assert.equal(row.seriesCount, 0);
    assert.equal(row.instancesCount, 0);
    assert.equal(row.source, "manual");
  });
});
