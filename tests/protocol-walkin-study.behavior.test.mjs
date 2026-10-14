// Walk-in створення дослідження з робочого місця лікаря (POST
// /api/staff/protocols/studies). Реальний D1: дослідження створюється виконаним
// і одразу потрапляє в чергу протоколів; межі ролей дотримано.

import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const CT_BRAIN = "401"; // КТ головного мозку (lib/catalog SERVICES)

async function createStudy(db, cookie, body) {
  return callWorker(jsonRequest("/api/staff/protocols/studies", body, { method: "POST", headers: { cookie } }), db);
}
async function queue(db, cookie) {
  const res = await callWorker(new Request("http://localhost/api/staff/protocols", { headers: { cookie } }), db);
  const data = await res.json();
  return data.queue || [];
}

test("admin creates a walk-in study that appears in the queue as performed", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const res = await createStudy(db, admin, { name: "Тест Пацієнт", phone: "0501234567", serviceCode: CT_BRAIN, clinicalIndication: "головний біль" });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.ok, true);
    assert.ok(data.bookingId > 0);
    const items = await queue(db, admin);
    const row = items.find((i) => i.id === data.bookingId);
    assert.ok(row, "walk-in study must appear in the queue");
    assert.notEqual(row.performedAt, "", "walk-in is marked performed");
  });
});

test("registrar can create; radiologist cannot (role boundary unchanged)", async () => {
  await withD1(async (db) => {
    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    const ok = await createStudy(db, reg, { name: "P", phone: "0501110000", serviceCode: CT_BRAIN });
    assert.equal(ok.status, 200);
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const denied = await createStudy(db, doc, { name: "P2", phone: "0502220000", serviceCode: CT_BRAIN });
    assert.equal(denied.status, 403);
  });
});

test("missing name/phone/service is rejected", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    assert.equal((await createStudy(db, admin, { name: "", phone: "0501234567", serviceCode: CT_BRAIN })).status, 400);
    assert.equal((await createStudy(db, admin, { name: "X", phone: "", serviceCode: CT_BRAIN })).status, 400);
    assert.equal((await createStudy(db, admin, { name: "X", phone: "0501234567", serviceCode: "bogus" })).status, 400);
  });
});

test("assigned radiologist must be an active radiologist in the tenant", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const bad = await createStudy(db, admin, { name: "X", phone: "0501234567", serviceCode: CT_BRAIN, assignedRadiologistEmail: "ghost@example.com" });
    assert.equal(bad.status, 400);
    await seedStaffSession(db, { email: "realdoc@example.com", role: "radiologist", organizationId: 1 });
    const good = await createStudy(db, admin, { name: "X", phone: "0501234567", serviceCode: CT_BRAIN, assignedRadiologistEmail: "realdoc@example.com" });
    assert.equal(good.status, 200);
  });
});

test("walk-in links an existing patient card by patientId (dedupe)", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const pid = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    await db.prepare(
      `INSERT INTO patient_profiles (patient_id, organization_id, phone_normalized, display_name, birth_date, updated_by)
       VALUES (?, 1, '380501234567', 'Іваненко Іван', '1980-01-02', 'admin@example.com')`
    ).bind(pid).run();
    const res = await createStudy(db, admin, { name: "Іваненко Іван", phone: "0501234567", serviceCode: CT_BRAIN, patientId: pid });
    const { bookingId } = await res.json();
    const row = await db.prepare("SELECT patient_id AS pid FROM bookings WHERE id = ?").bind(bookingId).first();
    assert.equal(row.pid, pid, "booking must be linked to the existing patient card");
  });
});

test("walk-in rejects a patientId from another tenant / unknown", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const res = await createStudy(db, admin, { name: "X", phone: "0501234567", serviceCode: CT_BRAIN, patientId: "ffffffffffffffffffffffffffffffff" });
    assert.equal(res.status, 400, "unknown patient id must be rejected");
  });
});

test("walk-in study is tenant-scoped (created in caller's org)", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const res = await createStudy(db, admin, { name: "Scoped", phone: "0509998877", serviceCode: CT_BRAIN });
    const { bookingId } = await res.json();
    const row = await db.prepare("SELECT organization_id AS org FROM bookings WHERE id = ?").bind(bookingId).first();
    assert.equal(row.org, 1);
  });
});
