// Персистенція структурованих знахідок + авто-порівняння E3 (PR-E3).
// Реальний D1: round-trip findingsStructured через PUT/GET; immutability-тригер
// не дає змінити структуровані знахідки підписаного протоколу. UI — інспекція.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

let slot = 8;
async function seedBooking(db) {
  const time = `${String(slot++).padStart(2, "0")}:00`;
  const r = await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,status,performed_at,assigned_radiologist_email)
    VALUES (1,'STR-'||?,'Пацієнт','+380501234567','380501234567','1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-09-26',?,'civilian','pending','completed','2026-09-26T09:00:00','doc@example.com')`)
    .bind(String(slot), time).run();
  return Number(r.meta.last_row_id);
}

const STRUCTURED = [{ regionKey: "ct_chest", targetId: "lung", findingId: "nodule", laterality: "right", description: "вузол правої легені", conclusion: "вузол", measurements: { sizeMm: 8 }, noun: "вузла" }];

test("structured findings round-trip: saved via PUT, returned by GET", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const id = await seedBooking(db);
    const put = await callWorker(jsonRequest("/api/staff/protocols", {
      bookingId: id, baseVersion: 0, templateKey: "generic", method: "КТ", sections: {},
      findings: "опис", conclusion: "висновок", recommendations: "", number: "P-1", status: "draft",
      findingsStructured: STRUCTURED,
    }, { method: "PUT", headers: { cookie: doc } }), db);
    assert.equal(put.status, 200, await put.text());
    const res = await callWorker(new Request(`http://localhost/api/staff/protocols?bookingId=${id}`, { headers: { cookie: doc } }), db);
    const data = await res.json();
    assert.ok(Array.isArray(data.protocol.findingsStructured), "findingsStructured returned as array");
    assert.equal(data.protocol.findingsStructured.length, 1);
    assert.equal(data.protocol.findingsStructured[0].targetId, "lung");
  });
});

test("oversized structured payload is dropped (bounded), not stored raw", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const id = await seedBooking(db);
    const huge = Array.from({ length: 5000 }, () => STRUCTURED[0]);
    const put = await callWorker(jsonRequest("/api/staff/protocols", {
      bookingId: id, baseVersion: 0, templateKey: "generic", method: "КТ", sections: {},
      findings: "опис", conclusion: "висновок", recommendations: "", number: "P-1", status: "draft",
      findingsStructured: huge,
    }, { method: "PUT", headers: { cookie: doc } }), db);
    assert.equal(put.status, 200);
    const res = await callWorker(new Request(`http://localhost/api/staff/protocols?bookingId=${id}`, { headers: { cookie: doc } }), db);
    const data = await res.json();
    assert.deepEqual(data.protocol.findingsStructured, [], "oversized payload stored as empty");
  });
});

test("signed protocol structured findings are immutable (DB trigger)", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const id = await seedBooking(db);
    const save = (baseVersion, status) => callWorker(jsonRequest("/api/staff/protocols", {
      bookingId: id, baseVersion, templateKey: "generic", method: "КТ", sections: {},
      findings: "опис", conclusion: "висновок", recommendations: "", number: "P-1", status,
      findingsStructured: STRUCTURED,
    }, { method: "PUT", headers: { cookie: doc } }), db);
    assert.equal((await save(0, "draft")).status, 200);
    assert.equal((await save(1, "ready")).status, 200);
    const signed = await save(2, "signed");
    assert.equal(signed.status, 200, await signed.text());
    // Прямий UPDATE структурованих знахідок підписаного протоколу — заблоковано.
    await assert.rejects(
      db.prepare("UPDATE protocols SET findings_structured_json = '[]' WHERE booking_id = ?").bind(id).run(),
      /immutable/,
      "changing structured findings of a signed protocol must be blocked",
    );
  });
});

test("editor persists/loads structured findings and wires E3 auto-compare", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // Зберігає composed як findingsStructured; відновлює при відкритті.
  assert.match(page, /findingsStructured:composed/);
  assert.match(page, /setComposed\(data\.protocol && Array\.isArray\(data\.protocol\.findingsStructured\)/);
  // Авто-порівняння через чистий рушій compareStudies; вставка — append у висновок.
  assert.match(page, /function runAutoCompare/);
  assert.match(page, /compareStudies\(/);
  assert.match(page, /function insertDynamicsDraft/);
  assert.match(page, /Авто-порівняння структурованих знахідок \(E3\)/);
});

test("migration guards the new column in the signed-immutability trigger", async () => {
  const sql = await read("drizzle/0125_protocol_structured_findings.sql");
  assert.match(sql, /ADD `findings_structured_json`/);
  assert.match(sql, /DROP TRIGGER IF EXISTS protocols_signed_content_immutable/);
  assert.match(sql, /NEW\.findings_structured_json IS NOT OLD\.findings_structured_json/);
});
