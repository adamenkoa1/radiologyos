// Критичні знахідки: позначення/доведення/закриття, RBAC, ескалація в
// «червоні зони», ізоляція за організацією.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

async function booking(db, { org = 1, code = "CF-1" } = {}) {
  const r = await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, service, equipment_id, desired_date, desired_time, status, performed_at)
     VALUES (?, ?, 'Пацієнт', '+380501112233', 'КТ ОГК', 'ct', '2026-07-15', '10:00', 'completed', '2026-07-15 10:30:00')`
  ).bind(org, code).run();
  return Number(r.meta.last_row_id);
}

const cf = (db, cookie, body, method = "POST") =>
  callWorker(jsonRequest("/api/staff/critical-findings", body, { method, headers: { cookie } }), db);
const cfList = (db, cookie) =>
  callWorker(jsonRequest("/api/staff/critical-findings", undefined, { method: "GET", headers: { cookie } }), db);

test("flag → list → communicate → resolve lifecycle", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "rad@example.com", role: "radiologist", organizationId: 1 });
    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    const id = await booking(db);

    // Лікар позначає критичну знахідку.
    const flag = await cf(db, doc, { action: "flag", bookingId: id, note: "Пневмоторакс справа" });
    assert.equal(flag.status, 200);

    // З'являється у списку як open.
    let list = await (await cfList(db, reg)).json();
    assert.equal(list.findings.length, 1);
    assert.equal(list.findings[0].status, "open");
    assert.equal(list.findings[0].note, "Пневмоторакс справа");
    const fid = list.findings[0].id;

    // Доведення без «як саме» — 400.
    assert.equal((await cf(db, reg, { action: "communicate", id: fid, via: "" })).status, 400);
    // Реєстратор доводить телефоном.
    assert.equal((await cf(db, reg, { action: "communicate", id: fid, via: "телефон" })).status, 200);
    list = await (await cfList(db, reg)).json();
    assert.equal(list.findings[0].status, "communicated");
    assert.equal(list.findings[0].communicatedVia, "телефон");

    // Закриття прибирає зі списку відкритих.
    assert.equal((await cf(db, reg, { action: "resolve", id: fid })).status, 200);
    list = await (await cfList(db, reg)).json();
    assert.equal(list.findings.length, 0);
  });
});

test("flagging is limited to doctor/admin; a registrar cannot flag", async () => {
  await withD1(async (db) => {
    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    const id = await booking(db);
    assert.equal((await cf(db, reg, { action: "flag", bookingId: id, note: "x" })).status, 403);
  });
});

test("an open critical finding escalates into the red-zones dashboard as an alert", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "rad@example.com", role: "radiologist", organizationId: 1 });
    const admin = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    const id = await booking(db);
    await cf(db, doc, { action: "flag", bookingId: id, note: "Крововилив" });

    const rz = await callWorker(jsonRequest("/api/staff/management/red-zones", undefined, { method: "GET", headers: { cookie: admin } }), db);
    const body = await rz.json();
    const card = body.cards.find((c) => c.key === "criticalFindings");
    assert.equal(card.value, 1);
    assert.equal(card.status, "alert");
    assert.equal(body.cards[0].key, "criticalFindings"); // найгостріше — першим
  });
});

test("critical findings are isolated by organization", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Other', 1)").run();
    const doc2 = await seedStaffSession(db, { email: "rad2@example.com", role: "radiologist", organizationId: 2 });
    const foreignId = await booking(db, { org: 2, code: "CF-FOREIGN" });
    await cf(db, doc2, { action: "flag", bookingId: foreignId, note: "чуже" });

    const admin1 = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    const list = await (await cfList(db, admin1)).json();
    assert.equal(list.findings.length, 0); // чужі знахідки не видно
  });
});
