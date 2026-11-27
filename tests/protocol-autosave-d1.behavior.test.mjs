// Оптимізація D1 для автозбереження чернетки (legacy-app, cold-standby):
// авто-сейв (auto:true, draft) НЕ пише в security_audit_log; а якщо вміст
// клінічно не змінився — взагалі нічого не пише (без приросту версії та без
// зайвої незмінної ревізії). Ручні збереження та переходи статусу — повноцінні.
// Ревізії protocol_revisions — append-only похідна проєкція версій протоколу,
// керована тригерами БД, тож реальні зміни завжди дають нову незмінну ревізію.
// Реальний D1 через воркер. Без зміни оптимістичного блокування чи гейтів.

import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addBooking(db, code, email) {
  const r = await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, service, service_code,
       equipment_id, desired_date, desired_time, assigned_radiologist_email, performed_at)
     VALUES (1, ?, 'D1 Patient', '+380501110022', '380501110022', 'КТ органів грудної клітки', '408', 'ct',
       '2026-08-15', '10:00', ?, '2026-08-15T10:20:00')`
  ).bind(code, email).run();
  return Number(r.meta.last_row_id);
}
function draft(bookingId, baseVersion, findings, auto) {
  return {
    bookingId, baseVersion, templateKey:"generic", method:"КТ", sections:{},
    findings, conclusion:"", recommendations:"", number:"", status:"draft", auto,
  };
}
const put = (db, cookie, payload) =>
  callWorker(jsonRequest("/api/staff/protocols", payload, { method:"PUT", headers:{ cookie } }), db);
const auditCount = (db, bookingId) =>
  db.prepare("SELECT COUNT(*) AS n FROM security_audit_log WHERE resource='protocol' AND target_id=? AND action IN ('protocol_saved','protocol_signed')")
    .bind(String(bookingId)).first().then((r) => Number(r.n));
const revCount = (db, bookingId) =>
  db.prepare("SELECT COUNT(*) AS n FROM protocol_revisions WHERE booking_id=?").bind(bookingId).first().then((r) => Number(r.n));

test("auto draft save writes no audit row; manual draft save does", async () => {
  await withD1(async (db) => {
    const email = "d1-doc@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiologist", displayName:"D1 Doc" });
    const id = await addBooking(db, "D1-AUDIT", email);

    const a = await put(db, cookie, draft(id, 0, "Авто перший.", true));
    assert.equal(a.status, 200);
    assert.equal(await auditCount(db, id), 0, "auto save must NOT write security_audit_log");

    const m = await put(db, cookie, draft(id, 1, "Ручний.", false));
    assert.equal(m.status, 200);
    assert.equal(await auditCount(db, id), 1, "manual save writes exactly one audit row");
  });
});

test("repeated auto save with unchanged content is a no-op: no version bump, no new revision", async () => {
  await withD1(async (db) => {
    const email = "d1-doc2@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiologist", displayName:"D1 Doc2" });
    const id = await addBooking(db, "D1-NOOP", email);

    const r1 = await put(db, cookie, draft(id, 0, "Незмінний вміст.", true));
    assert.equal((await r1.json()).version, 1, "first auto save persists v1");
    assert.equal(await revCount(db, id), 1);

    // Той самий вміст приходить ще двічі (debounce спрацював без правок користувача).
    const r2 = await put(db, cookie, draft(id, 1, "Незмінний вміст.", true));
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).version, 1, "no-op keeps the current version");
    const r3 = await put(db, cookie, draft(id, 1, "Незмінний вміст.", true));
    assert.equal((await r3.json()).version, 1, "still no-op");

    assert.equal(await revCount(db, id), 1, "unchanged auto saves add no revisions");
    assert.equal(await auditCount(db, id), 0, "no audit noise from autosaves");
    const ev = await db.prepare(
      "SELECT COUNT(*) AS n FROM booking_events WHERE booking_id=? AND action='protocol_document_saved'"
    ).bind(id).first().then((r) => Number(r.n));
    assert.equal(ev, 1, "no-op autosaves emit no extra booking events");
  });
});

test("auto save with changed content still creates the next immutable revision", async () => {
  await withD1(async (db) => {
    const email = "d1-doc3@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiologist", displayName:"D1 Doc3" });
    const id = await addBooking(db, "D1-CHG", email);

    const r1 = await put(db, cookie, draft(id, 0, "Чернетка A.", true));
    assert.equal((await r1.json()).version, 1);
    assert.equal(await revCount(db, id), 1);

    // Реальна правка → нова версія і нова append-only ревізія (історія цілісна).
    const r2 = await put(db, cookie, draft(id, 1, "Чернетка B.", true));
    assert.equal((await r2.json()).version, 2, "changed content advances the version");
    assert.equal(await revCount(db, id), 2, "each real change is an immutable revision");

    const latest = await db.prepare(
      "SELECT findings FROM protocol_revisions WHERE booking_id=? ORDER BY version DESC LIMIT 1"
    ).bind(id).first();
    assert.equal(latest.findings, "Чернетка B.");
    assert.equal(await auditCount(db, id), 0, "changed autosaves still write no audit");
  });
});

test("default (no auto flag) behaves as a manual save — backward compatible", async () => {
  await withD1(async (db) => {
    const email = "d1-doc4@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiologist", displayName:"D1 Doc4" });
    const id = await addBooking(db, "D1-BC", email);
    const payload = draft(id, 0, "Без прапора.", undefined);
    delete payload.auto;
    const r = await put(db, cookie, payload);
    assert.equal(r.status, 200);
    assert.equal(await auditCount(db, id), 1, "absent auto flag → audited like a manual save");
    assert.equal(await revCount(db, id), 1);
  });
});
