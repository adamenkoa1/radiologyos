import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

// Exercise the lifecycle through raw D1 writes so API validation cannot mask a DB bypass.
async function addBooking(db, code) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service, desired_date, desired_time)
     VALUES (1, ?, 'Lifecycle Guard Patient', '+380501110099', '380501110099', 'КТ', '2026-08-20', '10:00')`,
  ).bind(code).run();
  return Number(result.meta.last_row_id);
}

function insertProtocol(db, bookingId, status, version = 1) {
  const signed = status === "signed" || status === "issued";
  return db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, template_key, method, findings, conclusion, number,
       status, version, author_email, updated_by, signed_by, signed_at, signed_version)
     VALUES (1, ?, 'generic', 'Method', 'Findings', 'Conclusion', ?, ?, ?,
       'doctor@example.com', 'doctor@example.com', ?, ?, ?)`,
  ).bind(
    bookingId,
    `D1-${bookingId}`,
    status,
    version,
    signed ? "doctor@example.com" : "",
    signed ? "2026-08-20 10:00:00" : "",
    signed ? version : 0,
  ).run();
}

test("D1 rejects direct finalized protocol inserts and unknown statuses", async () => {
  await withD1(async (db) => {
    const signedBooking = await addBooking(db, "LIFE-INSERT-SIGNED");
    await assert.rejects(
      insertProtocol(db, signedBooking, "signed"),
      /protocol must start draft or ready/i,
    );

    const issuedBooking = await addBooking(db, "LIFE-INSERT-ISSUED");
    await assert.rejects(
      insertProtocol(db, issuedBooking, "issued"),
      /protocol must start draft or ready/i,
    );

    const invalidBooking = await addBooking(db, "LIFE-INSERT-INVALID");
    await assert.rejects(
      insertProtocol(db, invalidBooking, "forged"),
      /protocol status invalid|protocol must start draft or ready/i,
    );

    const rows = await db.prepare(
      "SELECT COUNT(*) AS n FROM protocols WHERE booking_id IN (?, ?, ?)",
    ).bind(signedBooking, issuedBooking, invalidBooking).first("n");
    assert.equal(rows, 0);
  });
});

test("D1 enforces draft to ready to signed to issued lifecycle", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db, "LIFE-TRANSITIONS");
    await insertProtocol(db, bookingId, "draft", 1);

    await assert.rejects(
      db.prepare(
        `UPDATE protocols
         SET status='signed', version=2, signed_by='doctor@example.com',
             signed_at='2026-08-20 10:01:00', signed_version=2, updated_by='doctor@example.com'
         WHERE organization_id=1 AND booking_id=?`,
      ).bind(bookingId).run(),
      /protocol status transition invalid/i,
    );

    await assert.rejects(
      db.prepare(
        `UPDATE protocols
         SET status='issued', version=2, signed_by='doctor@example.com',
             signed_at='2026-08-20 10:01:00', signed_version=2, updated_by='doctor@example.com'
         WHERE organization_id=1 AND booking_id=?`,
      ).bind(bookingId).run(),
      /protocol status transition invalid/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET status='ready', version=2, updated_by='doctor@example.com'
       WHERE organization_id=1 AND booking_id=?`,
    ).bind(bookingId).run();

    await assert.rejects(
      db.prepare(
        `UPDATE protocols
         SET status='draft', version=3, updated_by='doctor@example.com'
         WHERE organization_id=1 AND booking_id=?`,
      ).bind(bookingId).run(),
      /protocol status transition invalid/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET status='signed', version=3, signed_by='doctor@example.com',
           signed_at='2026-08-20 10:02:00', signed_version=3, updated_by='doctor@example.com'
       WHERE organization_id=1 AND booking_id=?`,
    ).bind(bookingId).run();

    await db.prepare(
      "UPDATE protocols SET status='issued', updated_by='registrar@example.com' WHERE organization_id=1 AND booking_id=?",
    ).bind(bookingId).run();

    const protocol = await db.prepare(
      `SELECT status, version, signed_by AS signedBy, signed_version AS signedVersion
       FROM protocols WHERE organization_id=1 AND booking_id=?`,
    ).bind(bookingId).first();
    assert.deepEqual(Object.fromEntries(Object.entries(protocol)), {
      status: "issued",
      version: 3,
      signedBy: "doctor@example.com",
      signedVersion: 3,
    });

    const revisions = await db.prepare(
      `SELECT version, status FROM protocol_revisions
       WHERE organization_id=1 AND booking_id=? ORDER BY version`,
    ).bind(bookingId).all();
    assert.deepEqual(revisions.results.map((row) => [row.version, row.status]), [
      [1, "draft"],
      [2, "ready"],
      [3, "signed"],
    ]);
  });
});
