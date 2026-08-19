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

async function insertProtocol(db, {
  organizationId = 1,
  bookingId,
  version = 1,
  conclusion = "Historical conclusion",
  findings = "Historical findings",
  number = `PR-${version}`,
  updatedBy = "doctor@example.com",
} = {}) {
  await db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, template_key, method, sections_json,
       findings, conclusion, recommendations, number, status, version, author_email, updated_by)
     VALUES (?, ?, 'ct_brain', 'Method', '{"brain":{"parenchyma":"Historical field"}}',
       ?, ?, 'Historical recommendation', ?, 'ready', ?, ?, ?)`
  ).bind(organizationId, bookingId, findings, conclusion, number, version, updatedBy, updatedBy).run();
}

async function advanceProtocol(db, {
  organizationId = 1,
  bookingId,
  version,
  conclusion,
  findings,
  number,
  updatedBy = "doctor@example.com",
}) {
  await db.prepare(
    `UPDATE protocols
     SET conclusion=?, findings=?, number=?, version=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
     WHERE organization_id=? AND booking_id=?`
  ).bind(conclusion, findings, number, version, updatedBy, organizationId, bookingId).run();
}

test("protocol revisions are physically append-only in D1", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db);
    await insertProtocol(db, { bookingId });
    await advanceProtocol(db, {
      bookingId,
      version:2,
      conclusion:"Corrected conclusion",
      findings:"Historical findings",
      number:"PR-2",
    });

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
    await insertProtocol(db, { bookingId, updatedBy:email });
    await advanceProtocol(db, {
      bookingId,
      version:2,
      conclusion:"Current conclusion",
      findings:"Current findings",
      number:"PR-CURRENT",
      updatedBy:email,
    });
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
    await insertProtocol(db, { bookingId:ownId, updatedBy:"assigned@example.com" });
    await insertProtocol(db, {
      organizationId:2,
      bookingId:foreignId,
      conclusion:"Foreign secret conclusion",
      updatedBy:"assigned@example.com",
    });

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
