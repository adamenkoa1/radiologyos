import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

async function addBooking(db, code, time) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service, desired_date, desired_time)
     VALUES (1, ?, 'Completeness Patient', '+380501110088', '380501110088', 'КТ', '2026-08-21', ?)`,
  ).bind(code, time).run();
  return Number(result.meta.last_row_id);
}

function insertProtocol(db, bookingId, {
  status = "ready",
  number = "P-COMPLETE",
  conclusion = "КТ-ознаки без гострої патології.",
  version = 1,
} = {}) {
  return db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, template_key, method, findings, conclusion,
       number, status, version, author_email, updated_by)
     VALUES (1, ?, 'generic', 'КТ без контрастування', 'Опис', ?, ?, ?, ?,
       'doctor@example.com', 'doctor@example.com')`,
  ).bind(bookingId, conclusion, number, status, version).run();
}

test("D1 rejects incomplete ready protocol inserts while drafts remain editable", async () => {
  await withD1(async (db) => {
    const noNumber = await addBooking(db, "COMPLETE-NUMBER", "09:00");
    await assert.rejects(
      insertProtocol(db, noNumber, { number: "   " }),
      /finalized protocol requires number and conclusion/i,
    );

    const noConclusion = await addBooking(db, "COMPLETE-CONCLUSION", "10:00");
    await assert.rejects(
      insertProtocol(db, noConclusion, { conclusion: "\n\t\r" }),
      /finalized protocol requires number and conclusion/i,
    );

    const draftBooking = await addBooking(db, "COMPLETE-DRAFT", "11:00");
    await insertProtocol(db, draftBooking, {
      status: "draft",
      number: "",
      conclusion: "",
    });
    const draft = await db.prepare(
      "SELECT status, number, conclusion FROM protocols WHERE organization_id=1 AND booking_id=?",
    ).bind(draftBooking).first();
    assert.equal(draft.status, "draft");
    assert.equal(draft.number, "");
    assert.equal(draft.conclusion, "");
  });
});

test("D1 requires completeness on finalization and preserves it through signing", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db, "COMPLETE-LIFECYCLE", "12:00");
    await insertProtocol(db, bookingId, {
      status: "draft",
      number: "",
      conclusion: "",
    });

    await assert.rejects(
      db.prepare(
        `UPDATE protocols
         SET status='ready', version=2, updated_by='doctor@example.com'
         WHERE organization_id=1 AND booking_id=?`,
      ).bind(bookingId).run(),
      /finalized protocol requires number and conclusion/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET status='ready', version=2, number='P-COMPLETE-2',
           conclusion='Повний клінічний висновок.', updated_by='doctor@example.com'
       WHERE organization_id=1 AND booking_id=?`,
    ).bind(bookingId).run();

    await assert.rejects(
      db.prepare(
        `UPDATE protocols
         SET conclusion='', version=3, updated_by='doctor@example.com'
         WHERE organization_id=1 AND booking_id=?`,
      ).bind(bookingId).run(),
      /finalized protocol requires number and conclusion/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET status='signed', version=3, signed_by='doctor@example.com',
           signed_at=CURRENT_TIMESTAMP, signed_version=3, updated_by='doctor@example.com'
       WHERE organization_id=1 AND booking_id=?`,
    ).bind(bookingId).run();

    const signed = await db.prepare(
      `SELECT status, version, number, conclusion, signed_version AS signedVersion
       FROM protocols WHERE organization_id=1 AND booking_id=?`,
    ).bind(bookingId).first();
    assert.equal(signed.status, "signed");
    assert.equal(signed.version, 3);
    assert.equal(signed.number, "P-COMPLETE-2");
    assert.equal(signed.conclusion, "Повний клінічний висновок.");
    assert.equal(signed.signedVersion, 3);
  });
});

test("0106 preserves historical incomplete rows but requires repair before future mutation", async () => {
  let historicalBookingId = 0;
  await withD1(async (db) => {
    assert.ok(historicalBookingId > 0);
    const historical = await db.prepare(
      `SELECT status, version, number, conclusion
       FROM protocols WHERE organization_id=1 AND booking_id=?`,
    ).bind(historicalBookingId).first();
    assert.equal(historical.status, "ready");
    assert.equal(historical.version, 1);
    assert.equal(historical.number, "");
    assert.equal(historical.conclusion, "");

    await assert.rejects(
      db.prepare(
        "UPDATE protocols SET updated_by='doctor@example.com' WHERE organization_id=1 AND booking_id=?",
      ).bind(historicalBookingId).run(),
      /finalized protocol requires number and conclusion/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET number='P-HISTORICAL-REPAIRED', conclusion='Відновлений висновок.',
           version=2, updated_by='doctor@example.com'
       WHERE organization_id=1 AND booking_id=?`,
    ).bind(historicalBookingId).run();

    const repaired = await db.prepare(
      "SELECT version, number, conclusion FROM protocols WHERE organization_id=1 AND booking_id=?",
    ).bind(historicalBookingId).first();
    assert.equal(repaired.version, 2);
    assert.equal(repaired.number, "P-HISTORICAL-REPAIRED");
    assert.equal(repaired.conclusion, "Відновлений висновок.");
  }, {
    beforeMigration: ({ db: raw, file }) => {
      if (file !== "0106_protocol_clinical_completeness.sql") return;
      const booking = raw.prepare(
        `INSERT INTO bookings
          (organization_id, code, name, phone, phone_normalized, service, desired_date, desired_time)
         VALUES (1, 'COMPLETE-HISTORICAL', 'Historical Patient', '+380501110077',
           '380501110077', 'КТ', '2026-08-21', '13:00')`,
      ).run();
      historicalBookingId = Number(booking.lastInsertRowid);
      raw.prepare(
        `INSERT INTO protocols
          (organization_id, booking_id, template_key, method, findings, conclusion,
           number, status, version, author_email, updated_by)
         VALUES (1, ?, 'generic', 'КТ', 'Опис', '', '', 'ready', 1,
           'legacy@example.com', 'legacy@example.com')`,
      ).run(historicalBookingId);
    },
  });
});
