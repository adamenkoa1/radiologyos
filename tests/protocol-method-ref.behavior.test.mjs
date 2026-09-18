// Джерело методики / стандарт у протоколі: персистенція, round-trip і рендер.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function addBooking(db, code = "MREF-1") {
  const r = await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, service, equipment_id,
       desired_date, desired_time)
     VALUES (1, ?, 'Пацієнт', '+380501112233', 'КТ ОГК', 'ct', '2026-09-01', '10:00')`
  ).bind(code).run();
  return Number(r.meta.last_row_id);
}

test("migration 0116 adds method_ref to protocols", async () => {
  const migration = await read("drizzle/0116_protocol_method_ref.sql");
  assert.match(migration, /ALTER TABLE `protocols` ADD `method_ref`/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0116_protocol_method_ref"));

  await withD1(async (db, raw) => {
    const cols = raw.prepare("PRAGMA table_info(protocols)").all().map((r) => r.name);
    assert.ok(cols.includes("method_ref"));
  });
});

test("methodRef persists through save, round-trips on read and lands in the revision", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const bookingId = await addBooking(db);
    const methodRef = "Галузевий стандарт променевої діагностики (тест)";

    const put = await callWorker(jsonRequest("/api/staff/protocols", {
      bookingId, baseVersion: 0, templateKey: "ct_chest", status: "draft",
      method: "Спіральне сканування ОГК", methodRef,
      sections: {}, findings: "", conclusion: "", recommendations: "", number: "",
    }, { method: "PUT", headers: { cookie } }), db);
    assert.equal(put.status, 200);
    assert.equal((await put.json()).ok, true);

    // Round-trip через GET.
    const get = await callWorker(jsonRequest(
      `/api/staff/protocols?bookingId=${bookingId}`, undefined, { method: "GET", headers: { cookie } },
    ), db);
    assert.equal(get.status, 200);
    const body = await get.json();
    assert.equal(body.protocol.methodRef, methodRef);

    // Записано в поточний документ протоколу.
    const row = await db.prepare("SELECT method_ref AS m FROM protocols WHERE booking_id = ?").bind(bookingId).first();
    assert.equal(row.m, methodRef);
  });
});

test("protocol library renders the method source and ships modality defaults", async () => {
  const src = await read("lib/protocols.ts");
  assert.match(src, /export function defaultMethodRef/);
  assert.match(src, /Джерело методики: \$\{methodRef\}/);
  assert.match(src, /methodRef: clip\(raw\.methodRef, PROTOCOL_LIMITS\.methodRef\)/);
  assert.match(src, /methodRef: template\.methodRef \|\| defaultMethodRef\(template\.equipmentId\)/);

  const lifecycle = await read("lib/protocol-lifecycle.ts");
  assert.match(lifecycle, /raw\.methodRef, PROTOCOL_LIMITS\.methodRef, "Джерело методики"/);

  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /method_ref AS methodRef/);
  assert.match(route, /method_ref = excluded\.method_ref/);
});
