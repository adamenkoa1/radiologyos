// Персональні макроси лікаря (Этап D5b, §7, міграція 0123). Перевірка на
// реальному D1: CRUD власних макросів; доступ лише для ролей, що редагують
// протоколи; writes/deletes обмежені власником; tenant+owner-ізоляція;
// аудит. UI вставляє макрос у вибране поле (append), не перезаписуючи текст.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("migration 0123 creates protocol_macros and is registered in the journal", async () => {
  const migration = await read("drizzle/0123_protocol_macros.sql");
  assert.match(migration, /CREATE TABLE `protocol_macros`/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0123_protocol_macros"));
  await withD1(async (_db, raw) => {
    const cols = raw.prepare("PRAGMA table_info(protocol_macros)").all().map((r) => r.name);
    for (const c of ["id", "organization_id", "owner_email", "title", "body"]) assert.ok(cols.includes(c), `has ${c}`);
  });
});

test("a doctor can create, list, edit and delete their own macros", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "rad@example.com", role: "radiologist", organizationId: 1 });

    const create = await callWorker(jsonRequest("/api/staff/protocols/macros",
      { title: "Норма ОГК", body: "Органи грудної клітки без вогнищевих та інфільтративних змін." },
      { method: "POST", headers: { cookie } }), db);
    assert.equal(create.status, 201);
    const created = (await create.json()).macro;
    assert.ok(created.id);

    const list = await callWorker(jsonRequest("/api/staff/protocols/macros", undefined, { method: "GET", headers: { cookie } }), db);
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).macros.map((m) => m.title), ["Норма ОГК"]);

    const edit = await callWorker(jsonRequest("/api/staff/protocols/macros",
      { id: created.id, title: "Норма ОГК (v2)", body: "Без патологічних змін." },
      { method: "PATCH", headers: { cookie } }), db);
    assert.equal(edit.status, 200);
    assert.equal((await edit.json()).macro.title, "Норма ОГК (v2)");

    const del = await callWorker(jsonRequest("/api/staff/protocols/macros", { id: created.id }, { method: "DELETE", headers: { cookie } }), db);
    assert.equal(del.status, 200);
    const after = await callWorker(jsonRequest("/api/staff/protocols/macros", undefined, { method: "GET", headers: { cookie } }), db);
    assert.deepEqual((await after.json()).macros, []);
  });
});

test("macros are private to their owner — another doctor cannot see, edit or delete them", async () => {
  await withD1(async (db) => {
    const owner = await seedStaffSession(db, { email: "owner@example.com", role: "radiologist", organizationId: 1 });
    const other = await seedStaffSession(db, { email: "other@example.com", role: "radiologist", organizationId: 1 });

    const create = await callWorker(jsonRequest("/api/staff/protocols/macros",
      { title: "Приватний", body: "Текст власника." }, { method: "POST", headers: { cookie: owner } }), db);
    const id = (await create.json()).macro.id;

    // Інший лікар не бачить чужі макроси.
    const otherList = await callWorker(jsonRequest("/api/staff/protocols/macros", undefined, { method: "GET", headers: { cookie: other } }), db);
    assert.deepEqual((await otherList.json()).macros, []);

    // Не може редагувати чи видалити чужий макрос (404, не чіпаючи його).
    const otherEdit = await callWorker(jsonRequest("/api/staff/protocols/macros",
      { id, title: "Викрадено", body: "хак" }, { method: "PATCH", headers: { cookie: other } }), db);
    assert.equal(otherEdit.status, 404);
    const otherDel = await callWorker(jsonRequest("/api/staff/protocols/macros", { id }, { method: "DELETE", headers: { cookie: other } }), db);
    assert.equal(otherDel.status, 404);

    // Власник досі бачить незмінний макрос.
    const ownerList = await callWorker(jsonRequest("/api/staff/protocols/macros", undefined, { method: "GET", headers: { cookie: owner } }), db);
    assert.deepEqual((await ownerList.json()).macros.map((m) => m.title), ["Приватний"]);
  });
});

test("macros require a protocol-editing role and validate input bounds", async () => {
  await withD1(async (db) => {
    const registrar = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    const denied = await callWorker(jsonRequest("/api/staff/protocols/macros",
      { title: "x", body: "y" }, { method: "POST", headers: { cookie: registrar } }), db);
    assert.equal(denied.status, 403);

    const rad = await seedStaffSession(db, { email: "rad2@example.com", role: "radiologist", organizationId: 1 });
    const empty = await callWorker(jsonRequest("/api/staff/protocols/macros",
      { title: "", body: "" }, { method: "POST", headers: { cookie: rad } }), db);
    assert.equal(empty.status, 400);
  });
});

test("editor wires a personal macros panel that appends into a chosen field", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /\/api\/staff\/protocols\/macros/);
  assert.match(page, /function insertMacro\(text:string\)/);
  // Вставлення — append у вибране поле, без перезапису.
  assert.match(page, /patchDoc\(\{ \[macroTarget\]: base \? `\$\{base\}\\n\$\{snippet\}` : snippet \}\)/);
  assert.match(page, /className="protocolMacros"/);
  const css = await read("app/styles/02-workspace.css");
  for (const cls of ["protocolMacros", "protocolMacrosList", "protocolMacroDelete", "protocolMacrosForm", "protocolMacrosEmpty", "protocolMacroTarget"]) {
    assert.match(css, new RegExp(`\\.${cls}[{ ,>:]`), `${cls} declared`);
  }
});
