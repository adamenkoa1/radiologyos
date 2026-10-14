// Блок порівняння з попереднім дослідженням (#8, легка read-only версія, PR-E2).
// by-id endpoint повертає priorStudies того самого пацієнта з наявним протоколом
// (реальний D1); редактор показує селектор + side-by-side (інспекція джерела).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

let slot = 8;
async function seedBooking(db, { phone = "380501234567", patientId = "" } = {}) {
  const time = `${String(slot++).padStart(2, "0")}:00`;
  const r = await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,status,performed_at,assigned_radiologist_email)
    VALUES (1,'CMP-'||?,'Пацієнт','+'||?,?,?,'1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-09-26',?,'civilian','pending','completed','2026-09-26T0'||?||':00:00','doc@example.com')`)
    .bind(String(slot), phone, phone, patientId, time, slot).run();
  return Number(r.meta.last_row_id);
}

test("by-id returns prior studies of the same patient that have a protocol", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const prior = await seedBooking(db, { phone: "380501234567" });
    const current = await seedBooking(db, { phone: "380501234567" });
    // Дати попередньому дослідженню протокол.
    const put = await callWorker(jsonRequest("/api/staff/protocols", {
      bookingId: prior, baseVersion: 0, templateKey: "generic", method: "КТ", sections: {},
      findings: "попередній опис", conclusion: "попередній висновок", recommendations: "", number: "P-PRIOR", status: "draft",
    }, { method: "PUT", headers: { cookie: doc } }), db);
    assert.equal(put.status, 200, await put.text());

    const res = await callWorker(new Request(`http://localhost/api/staff/protocols?bookingId=${current}`, { headers: { cookie: doc } }), db);
    const data = await res.json();
    assert.ok(Array.isArray(data.priorStudies), "priorStudies array present");
    assert.ok(data.priorStudies.find((p) => p.id === prior), "prior study with a protocol listed");
    // Поточне дослідження не повинно бути у власному списку порівняння.
    assert.equal(data.priorStudies.find((p) => p.id === current), undefined);
  });
});

test("a different patient's study is not offered for comparison", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const other = await seedBooking(db, { phone: "380509999999" });
    await callWorker(jsonRequest("/api/staff/protocols", {
      bookingId: other, baseVersion: 0, templateKey: "generic", method: "КТ", sections: {},
      findings: "x", conclusion: "y", recommendations: "", number: "P-OTHER", status: "draft",
    }, { method: "PUT", headers: { cookie: doc } }), db);
    const current = await seedBooking(db, { phone: "380501234567" });
    const res = await callWorker(new Request(`http://localhost/api/staff/protocols?bookingId=${current}`, { headers: { cookie: doc } }), db);
    const data = await res.json();
    assert.equal(data.priorStudies.find((p) => p.id === other), undefined, "other patient must not leak into comparison");
  });
});

test("editor renders the comparison block (selector + side-by-side) read-only", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /className="protocolCompare"/);
  assert.match(page, /Порівняння з попереднім дослідженням/);
  assert.match(page, /priorStudies\.map\(\(p\)=>/);
  assert.match(page, /className="protocolCompareGrid"/);
  // Завантаження попереднього — read-only, через той самий by-id endpoint.
  assert.match(page, /async function loadComparison/);
  assert.match(page, /setPriorStudies\(Array\.isArray\(data\.priorStudies\)/);
});
