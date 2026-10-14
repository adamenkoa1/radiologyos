// Черга /staff/protocols показує РЕАЛЬНІ створені дослідження, яким потрібен
// протокол — не лише вже виконані (корінь порожньої черги на проді).
// Перевірка на реальному локальному D1 через воркер.

import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, seedStaffSession, withD1 } from "./helpers/d1.mjs";

let slot = 8;
async function seedBooking(db, { code, status = "confirmed", performedAt = "", organizationId = 1, name = "Study Patient", doctor = "" }) {
  const time = `${String(slot++).padStart(2, "0")}:00`; // унікальний слот, щоб не впертись у guard місткості
  const r = await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,status,
     anatomical_regions_count,assigned_radiologist_email,performed_at)
    VALUES (?,?,?,'+380501110099','380501110099','1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-09-26',?,'civilian','pending',?,1,?,?)`)
    .bind(organizationId, code, name, time, status, doctor, performedAt).run();
  return Number(r.meta.last_row_id);
}

async function queue(db, cookie) {
  const res = await callWorker(new Request("http://localhost/api/staff/protocols", { headers: { cookie } }), db);
  assert.equal(res.status, 200, "queue GET ok");
  const data = await res.json();
  return data.queue || [];
}

test("a created (confirmed, NOT performed) study appears in the queue as awaiting", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const id = await seedBooking(db, { code: "CREATED-1", status: "confirmed", performedAt: "" });
    const items = await queue(db, admin);
    const row = items.find((i) => i.id === id);
    assert.ok(row, "created, not-performed study must be in the queue");
    assert.equal(row.performedAt, "", "still not performed");
    assert.equal(row.documentStatus, "", "no protocol yet");
    assert.equal(row.protocolStatus, "not_started", "projection still not_started");
  });
});

test("a performed study also appears (unchanged behavior)", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const id = await seedBooking(db, { code: "PERF-1", status: "completed", performedAt: "2026-09-26T10:05:00" });
    const items = await queue(db, admin);
    assert.ok(items.find((i) => i.id === id), "performed study present");
  });
});

test("a cancelled study is still excluded", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const id = await seedBooking(db, { code: "CANX-1", status: "cancelled", performedAt: "" });
    const items = await queue(db, admin);
    assert.equal(items.find((i) => i.id === id), undefined, "cancelled must be excluded");
  });
});

test("radiologist sees only studies assigned to them (role scope unchanged)", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const mine = await seedBooking(db, { code: "MINE-1", status: "confirmed", doctor: "doc@example.com" });
    const notmine = await seedBooking(db, { code: "NOTMINE-1", status: "confirmed", doctor: "other@example.com" });
    const items = await queue(db, doc);
    assert.ok(items.find((i) => i.id === mine), "assigned study shown");
    assert.equal(items.find((i) => i.id === notmine), undefined, "unassigned study hidden from radiologist");
  });
});
