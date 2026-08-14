import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addBooking(db, { organizationId = 1, code = "REV-001", assignedRadiologistEmail = "" } = {}) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, service, desired_date, desired_time, assigned_radiologist_email)
     VALUES (?, ?, 'Revision Patient', '+380501112233', 'CT', '2026-09-01', '10:00', ?)`
  ).bind(organizationId, code, assignedRadiologistEmail).run();
  return Number(result.meta.last_row_id);
}

async function addRevision(db, organizationId, bookingId, version, conclusion = "Historical conclusion") {
  await db.prepare(
    `INSERT INTO protocol_revisions
      (organization_id, booking_id, version, template_key, method, sections_json,
       findings, conclusion, recommendations, number, status, saved_by)
     VALUES (?, ?, ?, 'ct_brain', 'Method', '{"brain":{"parenchyma":"Historical field"}}',
       'Historical findings', ?, 'Historical recommendation', ?, 'ready', 'doctor@example.com')`
  ).bind(organizationId, bookingId, version, conclusion, `PR-${version}`).run();
}

test("protocol revisions are physically append-only in D1", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db);
    await addRevision(db, 1, bookingId, 1);
    await addRevision(db, 1, bookingId, 2, "Corrected conclusion");

    await assert.rejects(
      db.prepare("UPDATE protocol_revisions SET conclusion='rewritten' WHERE organization_id=1 AND booking_id=? AND version=1")
        .bind(bookingId).run(),
      /append-only/i,
    );
    await assert.rejects(
      db.prepare("DELETE FROM protocol_revisions WHERE organization_id=1 AND booking_id=? AND version=1")
        .bind(bookingId).run(),
      /append-only/i,
    );

    const rows = await db.prepare(
      "SELECT version, conclusion FROM protocol_revisions WHERE organization_id=1 AND booking_id=? ORDER BY version"
    ).bind(bookingId).all();
    assert.deepEqual(rows.results.map((row) => [row.version, row.conclusion]), [
      [1, "Historical conclusion"],
      [2, "Corrected conclusion"],
    ]);
  });
});

test("authorized clinician can read an exact historical snapshot without mutating current protocol", async () => {
  await withD1(async (db) => {
    const email = "radiologist@example.com";
    const bookingId = await addBooking(db, { assignedRadiologistEmail:email });
    await addRevision(db, 1, bookingId, 1);
    await db.prepare(
      `INSERT INTO protocols
        (organization_id, booking_id, template_key, findings, conclusion, number, status, version, author_email, updated_by)
       VALUES (1, ?, 'ct_brain', 'Current findings', 'Current conclusion', 'PR-CURRENT', 'ready', 2, ?, ?)`
    ).bind(bookingId, email, email).run();
    const cookie = await seedStaffSession(db, { email, role:"radiologist" });

    const response = await callWorker(jsonRequest(
      `/api/staff/protocols/revisions?bookingId=${bookingId}&version=1`,
      undefined,
      { method:"GET", headers:{ cookie } },
    ), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.revision.version, 1);
    assert.equal(body.revision.conclusion, "Historical conclusion");
    assert.equal(body.revision.sections.brain.parenchyma, "Historical field");

    const current = await db.prepare(
      "SELECT conclusion, number, version FROM protocols WHERE organization_id=1 AND booking_id=?"
    ).bind(bookingId).first();
    assert.deepEqual(Object.fromEntries(Object.entries(current)), {
      conclusion:"Current conclusion", number:"PR-CURRENT", version:2,
    });

    const audit = await db.prepare(
      `SELECT action, target_id AS targetId, details_json AS detailsJson
       FROM security_audit_log WHERE action='protocol_revision_viewed' ORDER BY id DESC LIMIT 1`
    ).first();
    assert.equal(audit.targetId, `${bookingId}:1`);
    assert.deepEqual(JSON.parse(audit.detailsJson), { version:1 });
    assert.doesNotMatch(audit.detailsJson, /Historical|Current|PR-/);
  });
});

test("revision endpoint is role, assignment and tenant scoped", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id,slug,name,active) VALUES (2,'revision-other','Other',1)").run();
    const ownId = await addBooking(db, { code:"REV-OWN", assignedRadiologistEmail:"assigned@example.com" });
    const foreignId = await addBooking(db, { organizationId:2, code:"REV-FOREIGN", assignedRadiologistEmail:"assigned@example.com" });
    await addRevision(db, 1, ownId, 1);
    await addRevision(db, 2, foreignId, 1, "Foreign secret conclusion");

    const registrarCookie = await seedStaffSession(db, { email:"registrar@example.com", role:"registrar" });
    const registrar = await callWorker(jsonRequest(
      `/api/staff/protocols/revisions?bookingId=${ownId}&version=1`, undefined,
      { method:"GET", headers:{ cookie:registrarCookie } },
    ), db);
    assert.equal(registrar.status, 403);

    const otherDoctorCookie = await seedStaffSession(db, { email:"other-doctor@example.com", role:"radiologist" });
    const unassigned = await callWorker(jsonRequest(
      `/api/staff/protocols/revisions?bookingId=${ownId}&version=1`, undefined,
      { method:"GET", headers:{ cookie:otherDoctorCookie } },
    ), db);
    assert.equal(unassigned.status, 404);

    const adminCookie = await seedStaffSession(db, { email:"admin@example.com", role:"admin" });
    const crossTenant = await callWorker(jsonRequest(
      `/api/staff/protocols/revisions?bookingId=${foreignId}&version=1`, undefined,
      { method:"GET", headers:{ cookie:adminCookie } },
    ), db);
    assert.equal(crossTenant.status, 404);
    assert.doesNotMatch(JSON.stringify(await crossTenant.json()), /Foreign secret conclusion/);
  });
});
