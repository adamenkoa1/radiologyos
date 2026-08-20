import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const ALLOWED_ENV = {
  OUTBOUND_ALLOWED_HOSTS: "pacs.example.com,viewer.example.com",
};

async function saveSettings(db, cookie, viewerBaseUrl, env = ALLOWED_ENV) {
  return callWorker(jsonRequest("/api/staff/imaging/settings", {
    dicomwebBaseUrl: "https://pacs.example.com/dicom-web",
    viewerBaseUrl,
    aeTitle: "RADTEST",
    enabled: true,
    notes: "viewer policy",
  }, { method: "PUT", headers: { cookie } }), db, env);
}

async function seedBookingWithStudy(db) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id,
       desired_date, desired_time, status, performed_at)
     VALUES (1, 'VIEWER-LEGACY-1', 'Viewer Legacy Patient', '+380501110077', '380501110077',
       'КТ ОГК', '403', 'ct', '2026-08-20', '10:00', 'completed', '2026-08-20T10:30:00')`,
  ).run();
  const bookingId = Number(result.meta.last_row_id);
  await db.prepare(
    `INSERT INTO imaging_studies
      (organization_id, booking_id, accession_number, study_instance_uid, modality,
       series_count, instances_count, study_status, study_datetime, source, updated_by)
     VALUES (1, ?, 'VIEWER-LEGACY-1', '1.2.840.113619.2.55.3.720001', 'CT',
       1, 10, 'available', '2026-08-20T10:30:00', 'qido_accession', 'seed@example.com')`,
  ).bind(bookingId).run();
  return bookingId;
}

// Browser deep-links carry StudyInstanceUID, so the viewer host follows the same
// explicit HTTPS allowlist boundary as server-side DICOMweb calls.
test("PACS viewer URL must use HTTPS and an explicitly allowlisted host", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, {
      email: "viewer-policy-admin@example.com",
      role: "admin",
    });

    const allowed = await saveSettings(
      db,
      cookie,
      "https://viewer.example.com/viewer/{study}",
    );
    assert.equal(allowed.status, 200);
    const allowedBody = await allowed.json();
    assert.equal(allowedBody.settings.viewerBaseUrl, "https://viewer.example.com/viewer/{study}");

    const external = await saveSettings(
      db,
      cookie,
      "https://untrusted.example.net/viewer/{study}",
    );
    assert.equal(external.status, 400);
    assert.match((await external.json()).error, /переглядача.*політикою/i);

    const insecure = await saveSettings(
      db,
      cookie,
      "http://viewer.example.com/viewer/{study}",
    );
    assert.equal(insecure.status, 400);
    assert.match((await insecure.json()).error, /переглядача.*політикою/i);

    const stored = await db.prepare(
      `SELECT viewer_base_url AS viewerBaseUrl, dicomweb_base_url AS dicomwebBaseUrl
       FROM pacs_settings WHERE organization_id = 1 LIMIT 1`,
    ).first();
    assert.equal(stored.viewerBaseUrl, "https://viewer.example.com/viewer/{study}");
    assert.equal(stored.dicomwebBaseUrl, "https://pacs.example.com/dicom-web");
  });
});

test("viewer and DICOMweb hosts are independently allowlisted", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, {
      email: "viewer-policy-split@example.com",
      role: "admin",
    });

    const missingViewerHost = await saveSettings(
      db,
      cookie,
      "https://viewer.example.com/viewer",
      { OUTBOUND_ALLOWED_HOSTS: "pacs.example.com" },
    );
    assert.equal(missingViewerHost.status, 400);

    const row = await db.prepare(
      "SELECT viewer_base_url AS viewerBaseUrl FROM pacs_settings WHERE organization_id = 1 LIMIT 1",
    ).first();
    assert.equal(String(row?.viewerBaseUrl || ""), "");
  });
});

test("legacy unsafe stored viewer is suppressed at runtime until an admin repairs it", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, {
      email: "viewer-policy-legacy@example.com",
      role: "admin",
    });
    const bookingId = await seedBookingWithStudy(db);

    // Simulate data persisted before viewer host-policy enforcement. Admin
    // settings may still display it for repair, but clinical responses must not
    // turn it into a browser deep-link carrying StudyInstanceUID.
    await db.prepare(
      `UPDATE pacs_settings
       SET viewer_base_url='https://untrusted.example.net/viewer',
           dicomweb_base_url='', enabled=0
       WHERE organization_id=1`,
    ).run();

    const response = await callWorker(jsonRequest(
      `/api/staff/imaging?bookingId=${bookingId}`,
      undefined,
      { method: "GET", headers: { cookie } },
    ), db, { OUTBOUND_ALLOWED_HOSTS: "viewer.example.com" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.settings.viewerBaseUrl, "");
    assert.equal(body.viewerUrl, "");

    const stored = await db.prepare(
      "SELECT viewer_base_url AS viewerBaseUrl FROM pacs_settings WHERE organization_id=1",
    ).first();
    assert.equal(stored.viewerBaseUrl, "https://untrusted.example.net/viewer");
  });
});
