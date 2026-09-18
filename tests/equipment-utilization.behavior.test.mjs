// Звіт завантаженості обладнання: потужність/факт/бронювання, RBAC, ізоляція.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

const FROM = "2026-07-13";
const TO = "2026-07-19"; // 7 днів → рівно одна неділя закрита → 6 робочих днів

async function ctBooking(db, { org = 1, code, date, time, dur, status = "confirmed", performedAt = "" } = {}) {
  await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, service, equipment_id,
       desired_date, desired_time, duration_minutes, status, performed_at)
     VALUES (?, ?, 'П', '+380501112233', 'КТ', 'ct', ?, ?, ?, ?, ?)`
  ).bind(org, code, date, time, dur, status, performedAt).run();
}

const report = (db, cookie, from = FROM, to = TO) =>
  callWorker(jsonRequest(`/api/staff/reports/utilization?from=${from}&to=${to}`, undefined, { method: "GET", headers: { cookie } }), db);

test("utilization: capacity from schedule, performed vs booked, idle", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    // Виконане КТ (45 хв) + заплановане КТ (30 хв) + скасоване (не рахується).
    await ctBooking(db, { code: "U-DONE", date: "2026-07-15", time: "10:00", dur: 45, status: "completed", performedAt: "2026-07-15 10:45:00" });
    await ctBooking(db, { code: "U-PLAN", date: "2026-07-16", time: "11:00", dur: 30, status: "confirmed" });
    await ctBooking(db, { code: "U-CANC", date: "2026-07-17", time: "12:00", dur: 30, status: "cancelled" });

    const res = await report(db, cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    const ct = body.rows.find((r) => r.equipmentId === "ct");
    assert.equal(ct.workingDays, 6);              // 6 відкритих днів у 7-денному вікні
    assert.equal(ct.capacityMinutes, 2880);       // 6 × 480 (08:00–17:00 мінус обід)
    assert.equal(ct.performedMinutes, 45);        // лише виконане
    assert.equal(ct.performedCount, 1);
    assert.equal(ct.bookedMinutes, 75);           // 45 + 30, без скасованого
    assert.equal(ct.utilizationPct, 1.6);         // 45/2880
    assert.equal(ct.idleMinutes, 2835);           // 2880 − 45
    assert.equal(body.totals.performedMinutes, 45);
  });
});

test("utilization report is limited to management roles", async () => {
  await withD1(async (db) => {
    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    assert.equal((await report(db, reg)).status, 403); // реєстратор — ні

    const head = await seedStaffSession(db, { email: "head@example.com", role: "department_head", organizationId: 1 });
    assert.equal((await report(db, head)).status, 200); // завідувач — так

    const admin = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    assert.equal((await report(db, admin)).status, 200);
  });
});

test("utilization isolates performed studies by organization", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Other', 1)").run();
    const cookie = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    await ctBooking(db, { org: 2, code: "FOREIGN", date: "2026-07-15", time: "10:00", dur: 45, status: "completed", performedAt: "2026-07-15 10:45:00" });

    const body = await (await report(db, cookie)).json();
    const ct = body.rows.find((r) => r.equipmentId === "ct");
    assert.equal(ct.performedMinutes, 0); // чужі дослідження не враховано
  });
});
