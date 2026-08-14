import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";
import { parseQidoSeries } from "../lib/dicom.ts";

const PACS_ENV = { OUTBOUND_ALLOWED_HOSTS: "pacs.example.com" };

async function seedAdmin(db) {
  return seedStaffSession(db, { email:"auto-link-admin@example.com", role:"admin" });
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

function studyRow(accession, uid, { modality = "CT", date = "20260820" } = {}) {
  return {
    "00080020": { vr:"DA", Value:[date] },
    "00080030": { vr:"TM", Value:["103015"] },
    "00080050": { vr:"SH", Value:[accession] },
    "00080061": { vr:"CS", Value:[modality] },
    "0020000D": { vr:"UI", Value:[uid] },
  };
}

async function withMockFetch(payload, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/studies?")) {
      return Response.json(payload, { headers:{ "content-type":"application/dicom+json" } });
    }
    if (url.includes("/series")) {
      return Response.json([], { headers:{ "content-type":"application/dicom+json" } });
    }
    return new Response("not found", { status:404 });
  };
  try { return await fn(); } finally { globalThis.fetch = previous; }
}

async function autoLink(db, cookie, bookingId, payload) {
  return withMockFetch(payload, () => callWorker(jsonRequest("/api/staff/imaging", { bookingId }, {
    method:"POST", headers:{ cookie },
  }), db, PACS_ENV));
}

async function assertNoLinkAndRejectedAudit(db, bookingId, reason) {
  const row = await db.prepare(
    "SELECT booking_id FROM imaging_studies WHERE booking_id = ? AND organization_id = 1",
  ).bind(bookingId).first();
  assert.equal(row, null);
  const event = await db.prepare(
    `SELECT action, details FROM booking_events
     WHERE organization_id = 1 AND booking_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(bookingId).first();
  assert.equal(event.action, "imaging_auto_link_rejected");
  assert.match(event.details, new RegExp(reason));
  assert.doesNotMatch(event.details, /1\.2\.840|Пацієнт|\+380/);
}

test("auto-link rejects an exact Accession match when PACS modality differs", async () => {
  await withD1(async (db) => {
    const cookie = await seedAdmin(db);
    const bookingId = await seedBooking(db, "VALIDATE-MOD");
    await configurePacs(db);
    const response = await autoLink(db, cookie, bookingId, [
      studyRow("VALIDATE-MOD", "1.2.840.113619.2.55.3.1", { modality:"DX" }),
    ]);
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.status, "metadata_mismatch");
    assert.equal(body.reason, "modality_mismatch");
    assert.deepEqual(body.expected, { modality:"CT", date:"2026-08-20" });
    await assertNoLinkAndRejectedAudit(db, bookingId, "modality_mismatch");
  });
});

test("auto-link rejects an exact Accession match when PACS study date differs", async () => {
  await withD1(async (db) => {
    const cookie = await seedAdmin(db);
    const bookingId = await seedBooking(db, "VALIDATE-DATE");
    await configurePacs(db);
    const response = await autoLink(db, cookie, bookingId, [
      studyRow("VALIDATE-DATE", "1.2.840.113619.2.55.3.2", { date:"20260821" }),
    ]);
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.status, "metadata_mismatch");
    assert.equal(body.reason, "date_mismatch");
    await assertNoLinkAndRejectedAudit(db, bookingId, "date_mismatch");
  });
});

test("auto-link rejects QIDO rows missing required study metadata", async () => {
  await withD1(async (db) => {
    const cookie = await seedAdmin(db);
    const bookingId = await seedBooking(db, "VALIDATE-MISSING");
    await configurePacs(db);
    const row = studyRow("VALIDATE-MISSING", "1.2.840.113619.2.55.3.3");
    delete row["00080020"];
    const response = await autoLink(db, cookie, bookingId, [row]);
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.status, "metadata_mismatch");
    assert.equal(body.reason, "missing_metadata");
    await assertNoLinkAndRejectedAudit(db, bookingId, "missing_metadata");
  });
});

test("QIDO series parser drops malformed SeriesInstanceUID values", () => {
  const parsed = parseQidoSeries([
    { "0020000E":{ vr:"UI", Value:["1.2.840.10008.1.1"] }, "00080060":{ vr:"CS", Value:["CT"] } },
    { "0020000E":{ vr:"UI", Value:["1..2.BAD"] }, "00080060":{ vr:"CS", Value:["CT"] } },
    { "0020000E":{ vr:"UI", Value:["01.2.3"] }, "00080060":{ vr:"CS", Value:["CT"] } },
  ]);
  assert.deepEqual(parsed.map((series) => series.seriesInstanceUid), ["1.2.840.10008.1.1"]);
});
