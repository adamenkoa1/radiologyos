import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedPatientSession, withD1 } from "./helpers/d1.mjs";

const PHONE = "380971112233";
const CODE = "RD-260920-1";
const ADDENDUM = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADDENDUM_HIDDEN = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function plainRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function seedBooking(raw, { code = CODE, protocolStatus = "issued" } = {}) {
  const result = raw.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, date_of_birth,
       service, desired_date, desired_time, status, protocol_status, protocol_issued_at)
     VALUES (1, ?, 'Пацієнт Addendum', ?, ?, '1980-01-02',
       'КТ ОГК', '2026-09-20', '10:00', 'completed', ?,
       CASE WHEN ? = 'issued' THEN CURRENT_TIMESTAMP ELSE '' END)`,
  ).run(code, `+${PHONE}`, PHONE, protocolStatus, protocolStatus);
  return Number(result.lastInsertRowid);
}

function seedProtocol(raw, bookingId, status = "issued") {
  if (status === "issued") {
    raw.prepare(
      `INSERT INTO protocols
        (organization_id, booking_id, number, status, version, author_email, updated_by,
         findings, conclusion, signed_by, signed_at, signed_version)
       VALUES (1, ?, 'P-ADD-1', 'issued', 1, 'radiologist@example.com', 'radiologist@example.com',
         'Основний опис', 'Основний висновок', 'radiologist@example.com', CURRENT_TIMESTAMP, 1)`,
    ).run(bookingId);
  } else {
    raw.prepare(
      `INSERT INTO protocols
        (organization_id, booking_id, number, status, version, author_email, updated_by,
         findings, conclusion)
       VALUES (1, ?, 'P-DRAFT-1', 'draft', 1, 'radiologist@example.com', 'radiologist@example.com',
         'Чернетка', 'Чернетка')`,
    ).run(bookingId);
  }
}

function insertDraftAddendum(raw, bookingId, id = ADDENDUM, text = "Початкове виправлення") {
  raw.prepare(
    `INSERT INTO protocol_addenda
      (id, organization_id, booking_id, base_protocol_version, reason, correction_text,
       status, version, author_email, updated_by)
     VALUES (?, 1, ?, 1, 'Уточнення формулювання', ?, 'draft', 1,
       'radiologist@example.com', 'radiologist@example.com')`,
  ).run(id, bookingId, text);
}

test("D1 enforces addendum base, lifecycle, immutable identity and append-only revision history", async () => {
  await withD1(async (_db, raw) => {
    const draftBooking = seedBooking(raw, { code: "RD-260920-2", protocolStatus: "draft" });
    seedProtocol(raw, draftBooking, "draft");

    assert.throws(() => {
      raw.prepare(
        `INSERT INTO protocol_addenda
          (id, organization_id, booking_id, base_protocol_version, reason, correction_text,
           status, version, author_email, updated_by)
         VALUES ('cccccccccccccccccccccccccccccccc', 1, ?, 1, 'Причина', 'Текст',
           'draft', 1, 'radiologist@example.com', 'radiologist@example.com')`,
      ).run(draftBooking);
    }, /base must be issued/);

    const bookingId = seedBooking(raw);
    seedProtocol(raw, bookingId);

    assert.throws(() => {
      raw.prepare(
        `INSERT INTO protocol_addenda
          (id, organization_id, booking_id, base_protocol_version, reason, correction_text,
           status, version, author_email, updated_by, signed_by, signed_at, signed_version)
         VALUES ('dddddddddddddddddddddddddddddddd', 1, ?, 1, 'Причина', 'Текст',
           'issued', 1, 'radiologist@example.com', 'radiologist@example.com',
           'radiologist@example.com', CURRENT_TIMESTAMP, 1)`,
      ).run(bookingId);
    }, /must start as draft v1/);

    insertDraftAddendum(raw, bookingId);

    let revisions = raw.prepare(
      `SELECT version, status, correction_text AS correctionText
       FROM protocol_addendum_revisions WHERE addendum_id = ? ORDER BY version`,
    ).all(ADDENDUM);
    assert.deepEqual(plainRows(revisions), [{ version: 1, status: "draft", correctionText: "Початкове виправлення" }]);

    assert.throws(() => {
      raw.prepare(`UPDATE protocol_addendum_revisions SET correction_text = 'tamper' WHERE addendum_id = ?`).run(ADDENDUM);
    }, /append-only/);
    assert.throws(() => {
      raw.prepare(`DELETE FROM protocol_addendum_revisions WHERE addendum_id = ?`).run(ADDENDUM);
    }, /append-only/);
    assert.throws(() => {
      raw.prepare(`DELETE FROM protocol_addenda WHERE id = ?`).run(ADDENDUM);
    }, /immutable records/);

    assert.throws(() => {
      raw.prepare(
        `UPDATE protocol_addenda
         SET correction_text = 'Без нової версії', updated_by = 'radiologist@example.com'
         WHERE id = ?`,
      ).run(ADDENDUM);
    }, /require next version/);

    assert.throws(() => {
      raw.prepare(
        `UPDATE protocol_addenda
         SET status = 'signed', version = 2, signed_by = 'radiologist@example.com',
             signed_at = CURRENT_TIMESTAMP, signed_version = 2, updated_by = 'radiologist@example.com'
         WHERE id = ?`,
      ).run(ADDENDUM);
    }, /invalid protocol addendum status transition/);

    raw.prepare(
      `UPDATE protocol_addenda
       SET correction_text = 'Уточнений текст', status = 'ready', version = 2,
           updated_by = 'radiologist@example.com', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(ADDENDUM);

    raw.prepare(
      `UPDATE protocol_addenda
       SET status = 'signed', version = 3, updated_by = 'radiologist@example.com',
           signed_by = 'radiologist@example.com', signed_at = CURRENT_TIMESTAMP, signed_version = 3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(ADDENDUM);

    revisions = raw.prepare(
      `SELECT version, status, correction_text AS correctionText
       FROM protocol_addendum_revisions WHERE addendum_id = ? ORDER BY version`,
    ).all(ADDENDUM);
    assert.deepEqual(plainRows(revisions), [
      { version: 1, status: "draft", correctionText: "Початкове виправлення" },
      { version: 2, status: "ready", correctionText: "Уточнений текст" },
      { version: 3, status: "signed", correctionText: "Уточнений текст" },
    ]);

    assert.throws(() => {
      raw.prepare(`UPDATE protocol_addenda SET correction_text = 'tamper' WHERE id = ?`).run(ADDENDUM);
    }, /signed protocol addendum content is immutable/);
    assert.throws(() => {
      raw.prepare(`UPDATE protocol_addenda SET id = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' WHERE id = ?`).run(ADDENDUM);
    }, /identity is immutable/);
    assert.throws(() => {
      raw.prepare(`UPDATE protocol_addenda SET organization_id = 2 WHERE id = ?`).run(ADDENDUM);
    }, /scope is immutable/);

    raw.prepare(
      `UPDATE protocol_addenda
       SET status = 'issued', updated_by = 'registrar@example.com', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(ADDENDUM);

    let issueEvents = raw.prepare(
      `SELECT action, actor FROM booking_events
       WHERE booking_id = ? AND action = 'protocol_addendum_issued'`,
    ).all(bookingId);
    assert.deepEqual(plainRows(issueEvents), [{ action: "protocol_addendum_issued", actor: "registrar@example.com" }]);

    raw.prepare(
      `UPDATE protocol_addenda SET status = 'issued', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(ADDENDUM);
    issueEvents = raw.prepare(
      `SELECT action FROM booking_events
       WHERE booking_id = ? AND action = 'protocol_addendum_issued'`,
    ).all(bookingId);
    assert.equal(issueEvents.length, 1);
  });
});

test("patient protocol returns issued addenda only", async () => {
  await withD1(async (db, raw) => {
    const bookingId = seedBooking(raw);
    seedProtocol(raw, bookingId);

    insertDraftAddendum(raw, bookingId, ADDENDUM, "Видимий текст після видачі");
    raw.prepare(
      `UPDATE protocol_addenda SET status = 'ready', version = 2,
         updated_by = 'radiologist@example.com', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(ADDENDUM);
    raw.prepare(
      `UPDATE protocol_addenda SET status = 'signed', version = 3,
         updated_by = 'radiologist@example.com', signed_by = 'radiologist@example.com',
         signed_at = CURRENT_TIMESTAMP, signed_version = 3, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(ADDENDUM);
    raw.prepare(
      `UPDATE protocol_addenda SET status = 'issued', updated_by = 'registrar@example.com',
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(ADDENDUM);

    insertDraftAddendum(raw, bookingId, ADDENDUM_HIDDEN, "Секретна чернетка");
    raw.prepare(
      `UPDATE protocol_addenda SET status = 'ready', version = 2,
         updated_by = 'radiologist@example.com', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(ADDENDUM_HIDDEN);
    raw.prepare(
      `UPDATE protocol_addenda SET status = 'signed', version = 3,
         updated_by = 'radiologist@example.com', signed_by = 'radiologist@example.com',
         signed_at = CURRENT_TIMESTAMP, signed_version = 3, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(ADDENDUM_HIDDEN);

    const cookie = await seedPatientSession(db, PHONE, 1, { kind: "booking", value: CODE });
    const response = await callWorker(
      jsonRequest("/api/my-protocol", { code: CODE }, { method: "POST", headers: { cookie } }),
      db,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.protocol.conclusion, "Основний висновок");
    assert.equal(body.protocol.addenda.length, 1);
    assert.equal(body.protocol.addenda[0].id, ADDENDUM);
    assert.equal(body.protocol.addenda[0].correctionText, "Видимий текст після видачі");
    assert.equal(body.protocol.addenda[0].version, 3);
    assert.doesNotMatch(JSON.stringify(body), /Секретна чернетка|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  });
});
