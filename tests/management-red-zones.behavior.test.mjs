// Пульт завідувача (червоні зони): агрегація метрик, статуси, RBAC, ізоляція.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

async function booking(db, { org = 1, code, date, time, status = "confirmed", equipment = "ct",
  protocolStatus = "not_started", performedAt = "", paymentAmount = 0, paidAmount = 0 } = {}) {
  await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, service, equipment_id,
       desired_date, desired_time, status, protocol_status, performed_at, payment_amount, paid_amount)
     VALUES (?, ?, 'П', '+380501112233', 'КТ', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(org, code, equipment, date, time, status, protocolStatus, performedAt, paymentAmount, paidAmount).run();
}

const redZones = (db, cookie) =>
  callWorker(jsonRequest("/api/staff/management/red-zones", undefined, { method: "GET", headers: { cookie } }), db);

test("red-zones aggregates operational metrics into statuses", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    // Прострочений протокол: виконано давно, не готовий.
    await booking(db, { code: "OVD", date: "2020-01-02", time: "10:00", status: "completed", performedAt: "2020-01-02 10:30:00" });
    // Велика дебіторка.
    await booking(db, { code: "DEBT", date: "2026-07-14", time: "10:00", paymentAmount: 300000, paidAmount: 0 });
    // Непідтверджений запис.
    await booking(db, { code: "NEW", date: "2026-07-15", time: "10:00", status: "new" });

    const res = await redZones(db, cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    const byKey = Object.fromEntries(body.cards.map((c) => [c.key, c]));

    assert.equal(byKey.overdueProtocols.value, 1);
    assert.equal(byKey.overdueProtocols.status, "warn"); // 1 → warn (пороги 1/5)
    assert.equal(byKey.receivablesDue.value, 300000);
    assert.equal(byKey.receivablesDue.status, "alert");  // ≥200000
    assert.equal(byKey.newBookings.value, 1);
    assert.equal(byKey.newBookings.status, "ok");         // 1 < 10
    assert.ok(body.attention >= 2);                        // принаймні overdue + receivables
    assert.equal(body.cards[0].status, "alert");           // найгостріше — першим
  });
});

test("red-zones is limited to management roles", async () => {
  await withD1(async (db) => {
    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    assert.equal((await redZones(db, reg)).status, 403);
    const head = await seedStaffSession(db, { email: "head@example.com", role: "department_head", organizationId: 1 });
    assert.equal((await redZones(db, head)).status, 200);
    const admin = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    assert.equal((await redZones(db, admin)).status, 200);
  });
});

test("red-zones isolates metrics by organization", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Other', 1)").run();
    const cookie = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    await booking(db, { org: 2, code: "F-DEBT", date: "2026-07-14", time: "10:00", paymentAmount: 500000, paidAmount: 0 });

    const body = await (await redZones(db, cookie)).json();
    const receivables = body.cards.find((c) => c.key === "receivablesDue");
    assert.equal(receivables.value, 0); // чужа дебіторка не врахована
    assert.equal(body.attention, 0);
  });
});
