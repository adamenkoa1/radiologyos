import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addOrganization(db, id, slug) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (?, ?, ?, 1)"
  ).bind(id, slug, `Organization ${id}`).run();
}

test("staff imaging detail access is security-audited in the active tenant without PHI or PACS identifiers", async () => {
  await withD1(async (db) => {
    await addOrganization(db, 2, "audit-imaging");
    const cookie = await seedStaffSession(db, {
      email: "imaging-auditor@example.com",
      role: "admin",
      organizationId: 2,
    });
    const bookingResult = await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, service, service_code, equipment_id,
         desired_date, desired_time, patient_category, status, performed_at)
       VALUES (2, 'IMG-AUDIT-2', 'Sensitive Patient', '+380501112233', 'CT', '403', 'ct',
         '2026-09-01', '10:00', 'civilian', 'completed', '2026-09-01T10:30:00')`
    ).run();
    const bookingId = Number(bookingResult.meta.last_row_id);
    await db.prepare(
      `INSERT INTO imaging_studies
        (organization_id, booking_id, accession_number, study_instance_uid, modality,
         study_status, source, updated_by)
       VALUES (2, ?, 'SECRET-ACC-2', '1.2.840.113619.99.2', 'CT', 'available', 'manual', 'seed')`
    ).bind(bookingId).run();
    await db.prepare(
      `INSERT INTO pacs_settings
        (organization_id, dicomweb_base_url, viewer_base_url, ae_title, enabled)
       VALUES (2, '', 'https://viewer.secret.example/viewer', 'RAD2', 1)
       ON CONFLICT(organization_id) DO UPDATE SET
         viewer_base_url = excluded.viewer_base_url, enabled = excluded.enabled`
    ).run();

    const response = await callWorker(jsonRequest(`/api/staff/imaging?bookingId=${bookingId}`, undefined, {
      method: "GET",
      headers: { cookie },
    }), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.linkVerificationRequired, true);
    assert.equal(body.study.studyInstanceUid, "");
    assert.equal(body.viewerUrl, "");

    const event = await db.prepare(
      `SELECT organization_id AS organizationId, actor_email AS actorEmail,
              action, resource, target_id AS targetId, details_json AS detailsJson
       FROM security_audit_log
       WHERE action = 'imaging_study_viewed' ORDER BY id DESC LIMIT 1`
    ).first();
    assert.equal(event.organizationId, 2);
    assert.equal(event.actorEmail, "imaging-auditor@example.com");
    assert.equal(event.resource, "imaging");
    assert.equal(event.targetId, String(bookingId));
    assert.deepEqual(JSON.parse(event.detailsJson), {
      linked: true,
      seriesCount: 0,
      linkVerificationRequired: true,
    });
    assert.doesNotMatch(event.detailsJson, /Sensitive Patient|SECRET-ACC-2|1\.2\.840|viewer\.secret/i);
  });
});
