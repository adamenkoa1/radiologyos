import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addBooking(db, { code, assignedRadiologistEmail = "" }) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id,
       desired_date, desired_time, assigned_radiologist_email, performed_at)
     VALUES (1, ?, 'Signing Patient', '+380501112233', '380501112233',
       'КТ органів грудної клітки', '408', 'ct', '2026-08-15', '10:00', ?, '2026-08-15T10:20:00')`
  ).bind(code, assignedRadiologistEmail).run();
  return Number(result.meta.last_row_id);
}

function protocolPayload(bookingId, baseVersion, status, conclusion = "КТ-ознаки без гострої патології") {
  return {
    bookingId,
    baseVersion,
    templateKey:"generic",
    method:"КТ без внутрішньовенного контрастування",
    sections:{},
    findings:"Легенева тканина без свіжих вогнищевих змін.",
    conclusion,
    recommendations:"Клінічна кореляція.",
    number:`CT-${bookingId}`,
    status,
  };
}

async function putProtocol(db, cookie, payload) {
  return callWorker(
    jsonRequest("/api/staff/protocols", payload, { method:"PUT", headers:{ cookie } }),
    db,
  );
}

test("radiologist signs a ready protocol; delivery keeps the signed clinical version unchanged", async () => {
  await withD1(async (db) => {
    const email = "signer@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiologist", displayName:"Signer Doctor" });
    const bookingId = await addBooking(db, { code:"SIGN-001", assignedRadiologistEmail:email });

    const readyResponse = await putProtocol(db, cookie, protocolPayload(bookingId, 0, "ready"));
    assert.equal(readyResponse.status, 200);
    const ready = await readyResponse.json();
    assert.equal(ready.documentStatus, "ready");
    assert.equal(ready.protocolStatus, "ready");
    assert.equal(ready.version, 1);
    assert.equal(ready.signedBy, "");
    assert.equal(ready.signedAt, "");

    const signedResponse = await putProtocol(db, cookie, protocolPayload(bookingId, 1, "signed"));
    assert.equal(signedResponse.status, 200);
    const signed = await signedResponse.json();
    assert.equal(signed.documentStatus, "signed");
    assert.equal(signed.protocolStatus, "ready", "signed remains ready in the legacy delivery projection");
    assert.equal(signed.version, 2);
    assert.equal(signed.signedBy, email);
    assert.ok(signed.signedAt);
    assert.equal(signed.signedVersion, 2);

    let protocol = await db.prepare(
      `SELECT status, version, conclusion, signed_by AS signedBy, signed_at AS signedAt,
        signed_version AS signedVersion
       FROM protocols WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).first();
    assert.equal(protocol.status, "signed");
    assert.equal(protocol.version, 2);
    assert.equal(protocol.signedBy, email);
    assert.equal(protocol.signedVersion, 2);

    let booking = await db.prepare(
      `SELECT protocol_status AS status, protocol_ready_at AS readyAt, protocol_issued_at AS issuedAt
       FROM bookings WHERE organization_id=1 AND id=?`
    ).bind(bookingId).first();
    assert.equal(booking.status, "ready");
    assert.ok(booking.readyAt);
    assert.equal(booking.issuedAt, "");

    const revisionsBeforeIssue = await db.prepare(
      "SELECT version, status, saved_by AS savedBy FROM protocol_revisions WHERE organization_id=1 AND booking_id=? ORDER BY version"
    ).bind(bookingId).all();
    assert.deepEqual(revisionsBeforeIssue.results.map((row) => [row.version, row.status, row.savedBy]), [
      [1, "ready", email],
      [2, "signed", email],
    ]);

    const rewriteResponse = await putProtocol(
      db,
      cookie,
      protocolPayload(bookingId, 2, "signed", "SECRET REWRITTEN CONCLUSION"),
    );
    assert.equal(rewriteResponse.status, 409);

    const issueResponse = await putProtocol(db, cookie, protocolPayload(bookingId, 2, "issued"));
    assert.equal(issueResponse.status, 200);
    const issued = await issueResponse.json();
    assert.equal(issued.documentStatus, "issued");
    assert.equal(issued.protocolStatus, "issued");
    assert.equal(issued.version, 2, "delivery must not create a new clinical version");
    assert.equal(issued.signedBy, email);
    assert.equal(issued.signedVersion, 2);

    protocol = await db.prepare(
      `SELECT status, version, conclusion, signed_by AS signedBy, signed_at AS signedAt,
        signed_version AS signedVersion
       FROM protocols WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).first();
    assert.equal(protocol.status, "issued");
    assert.equal(protocol.version, 2);
    assert.equal(protocol.conclusion, "КТ-ознаки без гострої патології");
    assert.equal(protocol.signedBy, email);
    assert.equal(protocol.signedVersion, 2);

    booking = await db.prepare(
      `SELECT protocol_status AS status, protocol_ready_at AS readyAt, protocol_issued_at AS issuedAt
       FROM bookings WHERE organization_id=1 AND id=?`
    ).bind(bookingId).first();
    assert.equal(booking.status, "issued");
    assert.ok(booking.readyAt);
    assert.ok(booking.issuedAt);

    const revisionsAfterIssue = await db.prepare(
      "SELECT version, status FROM protocol_revisions WHERE organization_id=1 AND booking_id=? ORDER BY version"
    ).bind(bookingId).all();
    assert.deepEqual(revisionsAfterIssue.results.map((row) => [row.version, row.status]), [
      [1, "ready"],
      [2, "signed"],
    ]);

    await assert.rejects(
      db.prepare("UPDATE protocols SET conclusion='D1 rewrite' WHERE organization_id=1 AND booking_id=?")
        .bind(bookingId).run(),
      /signed protocol content is immutable/i,
    );

    const auditRows = await db.prepare(
      `SELECT action, details_json AS detailsJson FROM security_audit_log
       WHERE organization_id=1 AND target_id=? AND action IN ('protocol_signed','protocol_issued')
       ORDER BY id`
    ).bind(String(bookingId)).all();
    assert.deepEqual(auditRows.results.map((row) => row.action), ["protocol_signed", "protocol_issued"]);
    assert.doesNotMatch(JSON.stringify(auditRows.results), /Signing Patient|380501112233|SECRET/);
  });
});

test("legacy admin may prepare and issue, but cannot become the clinical signer", async () => {
  await withD1(async (db) => {
    const adminCookie = await seedStaffSession(db, { email:"legacy-admin@example.com", role:"admin" });
    const bookingId = await addBooking(db, { code:"SIGN-ADMIN" });

    const readyResponse = await putProtocol(db, adminCookie, protocolPayload(bookingId, 0, "ready"));
    assert.equal(readyResponse.status, 200);
    const ready = await readyResponse.json();
    assert.equal(ready.version, 1);

    const signResponse = await putProtocol(db, adminCookie, protocolPayload(bookingId, 1, "signed"));
    assert.equal(signResponse.status, 403);
    assert.match(JSON.stringify(await signResponse.json()), /лікар-рентгенолог/i);

    const issueResponse = await putProtocol(db, adminCookie, protocolPayload(bookingId, 1, "issued"));
    assert.equal(issueResponse.status, 409, "unsigned ready protocol cannot be delivered");

    const protocol = await db.prepare(
      "SELECT status, signed_by AS signedBy, signed_at AS signedAt FROM protocols WHERE organization_id=1 AND booking_id=?"
    ).bind(bookingId).first();
    assert.equal(protocol.status, "ready");
    assert.equal(protocol.signedBy, "");
    assert.equal(protocol.signedAt, "");
  });
});

test("D1 rejects unsigned or unversioned signing and preserves signature metadata through signed to issued", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db, { code:"SIGN-D1" });
    await db.prepare(
      `INSERT INTO protocols
       (organization_id, booking_id, template_key, method, findings, conclusion, number,
        status, version, author_email, updated_by)
       VALUES (1, ?, 'generic', 'Method', 'Findings', 'Conclusion', 'D1-001',
        'ready', 3, 'doctor@example.com', 'doctor@example.com')`
    ).bind(bookingId).run();

    await assert.rejects(
      db.prepare("UPDATE protocols SET status='signed', version=4 WHERE organization_id=1 AND booking_id=?")
        .bind(bookingId).run(),
      /protocol signature state mismatch/i,
    );

    await assert.rejects(
      db.prepare(
        `UPDATE protocols
         SET status='signed', signed_by='doctor@example.com', signed_at=CURRENT_TIMESTAMP,
             signed_version=version
         WHERE organization_id=1 AND booking_id=?`
      ).bind(bookingId).run(),
      /protocol edits require next version/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET status='signed', version=4, signed_by='doctor@example.com', signed_at=CURRENT_TIMESTAMP,
           signed_version=4, updated_by='doctor@example.com'
       WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).run();

    const signed = await db.prepare(
      `SELECT status, version, signed_by AS signedBy, signed_at AS signedAt, signed_version AS signedVersion
       FROM protocols WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).first();
    assert.equal(signed.status, "signed");
    assert.equal(signed.version, 4);
    assert.equal(signed.signedBy, "doctor@example.com");
    assert.ok(signed.signedAt);
    assert.equal(signed.signedVersion, 4);

    const signedRevision = await db.prepare(
      `SELECT status, saved_by AS savedBy FROM protocol_revisions
       WHERE organization_id=1 AND booking_id=? AND version=4`
    ).bind(bookingId).first();
    assert.deepEqual(Object.fromEntries(Object.entries(signedRevision)), {
      status: "signed",
      savedBy: "doctor@example.com",
    });

    await assert.rejects(
      db.prepare("UPDATE protocols SET version=5 WHERE organization_id=1 AND booking_id=?")
        .bind(bookingId).run(),
      /signed protocol content is immutable|signature state mismatch/i,
    );
    await assert.rejects(
      db.prepare("UPDATE protocols SET status='ready' WHERE organization_id=1 AND booking_id=?")
        .bind(bookingId).run(),
      /signed protocol status is immutable|signature state mismatch/i,
    );

    await db.prepare("UPDATE protocols SET status='issued' WHERE organization_id=1 AND booking_id=?")
      .bind(bookingId).run();
    const issued = await db.prepare(
      `SELECT status, version, signed_by AS signedBy, signed_at AS signedAt, signed_version AS signedVersion
       FROM protocols WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).first();
    assert.equal(issued.status, "issued");
    assert.equal(issued.version, 4);
    assert.equal(issued.signedBy, signed.signedBy);
    assert.equal(issued.signedAt, signed.signedAt);
    assert.equal(issued.signedVersion, signed.signedVersion);
  });
});

test("patient protocol endpoint still exposes only delivered issued documents", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/my-protocol/route.ts", import.meta.url), "utf8");
  assert.match(source, /protocolStatus !== "issued"/);
  assert.match(source, /status = 'issued'/);
  assert.doesNotMatch(source, /status = 'signed'/);
});
