// method_ref у клінічній історії (Этап D5a, міграція 0122). Перевіряє на
// справжньому D1/SQLite, що: колонку додано; зміна ЛИШЕ джерела методики
// (method_ref) створює нову незмінну версію; кожен знімок у protocol_revisions
// зберігає свій method_ref; попередні версії не переписуються; derived-history
// тригери лишаються цілісними.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function addBooking(db, code = "MREFREV-1") {
  const r = await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, service, equipment_id,
       desired_date, desired_time)
     VALUES (1, ?, 'Пацієнт', '+380501112233', 'КТ ОГК', 'ct', '2026-09-01', '10:00')`
  ).bind(code).run();
  return Number(r.meta.last_row_id);
}

test("migration 0122 adds method_ref to protocol_revisions and is registered in the journal", async () => {
  const migration = await read("drizzle/0122_protocol_revision_method_ref.sql");
  assert.match(migration, /ALTER TABLE `protocol_revisions` ADD `method_ref`/);
  // Бекфіл виконується зі знятим append-only update-guard і його відновленням.
  assert.match(migration, /DROP TRIGGER `protocol_revisions_append_only_update`/);
  assert.match(migration, /CREATE TRIGGER `protocol_revisions_append_only_update`/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0122_protocol_revision_method_ref"));

  await withD1(async (_db, raw) => {
    const cols = raw.prepare("PRAGMA table_info(protocol_revisions)").all().map((r) => r.name);
    assert.ok(cols.includes("method_ref"), "protocol_revisions has method_ref");
  });
});

test("a method_ref-only edit creates a new immutable version captured in history", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const bookingId = await addBooking(db);
    const common = {
      bookingId, templateKey: "ct_chest", status: "draft",
      method: "Спіральне сканування ОГК", sections: {}, findings: "", conclusion: "", recommendations: "", number: "",
    };

    // v1 — джерело методики "A".
    const put1 = await callWorker(jsonRequest("/api/staff/protocols",
      { ...common, baseVersion: 0, methodRef: "Джерело A" },
      { method: "PUT", headers: { cookie } }), db);
    assert.equal(put1.status, 200);
    assert.equal((await put1.json()).version, 1);

    // v2 — змінено ЛИШЕ method_ref на "B" (решта незмінна). Має пройти й стати v2.
    const put2 = await callWorker(jsonRequest("/api/staff/protocols",
      { ...common, baseVersion: 1, methodRef: "Джерело B" },
      { method: "PUT", headers: { cookie } }), db);
    assert.equal(put2.status, 200);
    assert.equal((await put2.json()).version, 2);

    // Кожна версія зберігає власний method_ref у protocol_revisions.
    const rows = await db.prepare(
      "SELECT version, method_ref AS m FROM protocol_revisions WHERE booking_id = ? AND organization_id = 1 ORDER BY version"
    ).bind(bookingId).all();
    assert.deepEqual(rows.results.map((r) => [Number(r.version), r.m]), [[1, "Джерело A"], [2, "Джерело B"]]);

    // Поточний документ — "B".
    const cur = await db.prepare("SELECT method_ref AS m, version FROM protocols WHERE booking_id = ?").bind(bookingId).first();
    assert.equal(cur.m, "Джерело B");
    assert.equal(Number(cur.version), 2);
  });
});

test("the revision endpoint returns the method_ref of the requested version", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "admin2@example.com", role: "admin", organizationId: 1 });
    const bookingId = await addBooking(db, "MREFREV-2");
    const common = {
      bookingId, templateKey: "ct_chest", status: "draft",
      method: "Метод", sections: {}, findings: "", conclusion: "", recommendations: "", number: "",
    };
    await callWorker(jsonRequest("/api/staff/protocols", { ...common, baseVersion: 0, methodRef: "Джерело A" }, { method: "PUT", headers: { cookie } }), db);
    await callWorker(jsonRequest("/api/staff/protocols", { ...common, baseVersion: 1, methodRef: "Джерело B" }, { method: "PUT", headers: { cookie } }), db);

    const v1 = await callWorker(jsonRequest(`/api/staff/protocols/revisions?bookingId=${bookingId}&version=1`, undefined, { method: "GET", headers: { cookie } }), db);
    assert.equal(v1.status, 200);
    assert.equal((await v1.json()).revision.methodRef, "Джерело A");

    const v2 = await callWorker(jsonRequest(`/api/staff/protocols/revisions?bookingId=${bookingId}&version=2`, undefined, { method: "GET", headers: { cookie } }), db);
    assert.equal(v2.status, 200);
    assert.equal((await v2.json()).revision.methodRef, "Джерело B");
  });
});
