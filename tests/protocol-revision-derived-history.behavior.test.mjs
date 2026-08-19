import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

async function addBooking(db, code) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, service, desired_date, desired_time)
     VALUES (1, ?, 'Revision Guard Patient', '+380501112233', 'CT', '2026-09-02', '10:00')`
  ).bind(code).run();
  return Number(result.meta.last_row_id);
}

async function insertReadyProtocol(db, bookingId, version = 1) {
  await db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, template_key, method, sections_json, findings, conclusion,
       recommendations, number, status, version, author_email, updated_by)
     VALUES (1, ?, 'generic', 'Method v1', '{}', 'Findings v1', 'Conclusion v1',
       'Recommendation v1', ?, 'ready', ?, 'doctor@example.com', 'doctor@example.com')`
  ).bind(bookingId, `PROTO-${bookingId}`, version).run();
}

test("D1 derives exact protocol snapshots and rejects unversioned clinical edits", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db, "REV-DERIVED-EDIT");
    await insertReadyProtocol(db, bookingId);

    const initial = await db.prepare(
      `SELECT version, conclusion, status, saved_by AS savedBy
       FROM protocol_revisions WHERE organization_id=1 AND booking_id=? ORDER BY version`
    ).bind(bookingId).all();
    assert.deepEqual(initial.results.map((row) => [row.version, row.conclusion, row.status, row.savedBy]), [
      [1, "Conclusion v1", "ready", "doctor@example.com"],
    ]);

    await assert.rejects(
      db.prepare(
        `UPDATE protocols
         SET conclusion='Unversioned rewrite', updated_by='editor@example.com'
         WHERE organization_id=1 AND booking_id=?`
      ).bind(bookingId).run(),
      /protocol edits require next version/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET conclusion='Conclusion v2', version=2, updated_by='editor@example.com', updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).run();

    const revisions = await db.prepare(
      `SELECT version, conclusion, status, saved_by AS savedBy
       FROM protocol_revisions WHERE organization_id=1 AND booking_id=? ORDER BY version`
    ).bind(bookingId).all();
    assert.deepEqual(revisions.results.map((row) => [row.version, row.conclusion, row.status, row.savedBy]), [
      [1, "Conclusion v1", "ready", "doctor@example.com"],
      [2, "Conclusion v2", "ready", "editor@example.com"],
    ]);

    await assert.rejects(
      db.prepare(
        `INSERT INTO protocol_revisions
          (organization_id, booking_id, version, template_key, conclusion, status, saved_by)
         VALUES (1, ?, 3, 'generic', 'Invented future history', 'ready', 'attacker@example.com')`
      ).bind(bookingId).run(),
      /protocol revision must match current document/i,
    );
  });
});

test("D1 requires signing to advance the immutable clinical version", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db, "REV-DERIVED-SIGN");
    await insertReadyProtocol(db, bookingId);

    await assert.rejects(
      db.prepare(
        `UPDATE protocols
         SET status='signed', signed_by='doctor@example.com', signed_at=CURRENT_TIMESTAMP,
             signed_version=1, updated_by='doctor@example.com'
         WHERE organization_id=1 AND booking_id=?`
      ).bind(bookingId).run(),
      /protocol edits require next version/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET status='signed', version=2, signed_by='doctor@example.com', signed_at=CURRENT_TIMESTAMP,
           signed_version=2, updated_by='doctor@example.com', updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).run();

    const protocol = await db.prepare(
      `SELECT status, version, signed_version AS signedVersion
       FROM protocols WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).first();
    assert.deepEqual(Object.fromEntries(Object.entries(protocol)), {
      status: "signed",
      version: 2,
      signedVersion: 2,
    });

    const revisions = await db.prepare(
      `SELECT version, status, saved_by AS savedBy
       FROM protocol_revisions WHERE organization_id=1 AND booking_id=? ORDER BY version`
    ).bind(bookingId).all();
    assert.deepEqual(revisions.results.map((row) => [row.version, row.status, row.savedBy]), [
      [1, "ready", "doctor@example.com"],
      [2, "signed", "doctor@example.com"],
    ]);
  });
});
