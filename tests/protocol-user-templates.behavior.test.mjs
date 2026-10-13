// Персональні повні шаблони лікаря (Этап D5c, §7, міграція 0124). Перевірка на
// реальному D1: збереження заготовки документа, валідація через sanitizeDocument
// (невідомий базовий шаблон / некоректний select відхиляються, номер+статус не
// зберігаються), owner-ізоляція, RBAC, CRUD; UI застосовує шаблон у редактор.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("migration 0124 creates protocol_user_templates and is registered", async () => {
  const migration = await read("drizzle/0124_protocol_user_templates.sql");
  assert.match(migration, /CREATE TABLE `protocol_user_templates`/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0124_protocol_user_templates"));
  await withD1(async (_db, raw) => {
    const cols = raw.prepare("PRAGMA table_info(protocol_user_templates)").all().map((r) => r.name);
    for (const c of ["id", "organization_id", "owner_email", "title", "base_template_key", "document_json"]) assert.ok(cols.includes(c), `has ${c}`);
  });
});

test("a doctor saves, lists and deletes a personal template; number/status are not persisted", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "rad@example.com", role: "radiologist", organizationId: 1 });
    const create = await callWorker(jsonRequest("/api/staff/protocols/user-templates", {
      title: "Мій КТ ОГК",
      baseTemplateKey: "ct_chest",
      document: {
        method: "Спіральне сканування ОГК", methodRef: "Галузевий стандарт",
        sections: { parameters: { contrast: "Без контрастування" } },
        findings: "", conclusion: "", recommendations: "",
        number: "НЕ-ЗБЕРІГАТИ", status: "issued",
      },
    }, { method: "POST", headers: { cookie } }), db);
    assert.equal(create.status, 201);
    const tpl = (await create.json()).template;
    const shape = JSON.parse(tpl.documentJson);
    assert.equal(shape.baseTemplateKey ?? "ct_chest", "ct_chest");
    assert.equal(shape.method, "Спіральне сканування ОГК");
    assert.equal(shape.methodRef, "Галузевий стандарт");
    assert.equal("number" in shape, false, "number is not persisted in the template");
    assert.equal("status" in shape, false, "status is not persisted in the template");

    const list = await callWorker(jsonRequest("/api/staff/protocols/user-templates", undefined, { method: "GET", headers: { cookie } }), db);
    assert.deepEqual((await list.json()).templates.map((t) => t.title), ["Мій КТ ОГК"]);

    const del = await callWorker(jsonRequest("/api/staff/protocols/user-templates", { id: tpl.id }, { method: "DELETE", headers: { cookie } }), db);
    assert.equal(del.status, 200);
    const after = await callWorker(jsonRequest("/api/staff/protocols/user-templates", undefined, { method: "GET", headers: { cookie } }), db);
    assert.deepEqual((await after.json()).templates, []);
  });
});

test("saving validates the base template and field values via sanitizeDocument", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "rad2@example.com", role: "radiologist", organizationId: 1 });
    const badBase = await callWorker(jsonRequest("/api/staff/protocols/user-templates",
      { title: "x", baseTemplateKey: "no_such", document: {} }, { method: "POST", headers: { cookie } }), db);
    assert.equal(badBase.status, 400);
    const badSelect = await callWorker(jsonRequest("/api/staff/protocols/user-templates",
      { title: "x", baseTemplateKey: "ct_chest", document: { sections: { parameters: { contrast: "Вигадане" } } } },
      { method: "POST", headers: { cookie } }), db);
    assert.equal(badSelect.status, 400);
  });
});

test("templates are private to their owner and require a protocol-editing role", async () => {
  await withD1(async (db) => {
    const owner = await seedStaffSession(db, { email: "owner@example.com", role: "radiologist", organizationId: 1 });
    const other = await seedStaffSession(db, { email: "other@example.com", role: "radiologist", organizationId: 1 });
    const registrar = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });

    const create = await callWorker(jsonRequest("/api/staff/protocols/user-templates",
      { title: "Приватний", baseTemplateKey: "ct_brain", document: { conclusion: "Норма." } },
      { method: "POST", headers: { cookie: owner } }), db);
    const id = (await create.json()).template.id;

    const otherList = await callWorker(jsonRequest("/api/staff/protocols/user-templates", undefined, { method: "GET", headers: { cookie: other } }), db);
    assert.deepEqual((await otherList.json()).templates, []);
    const otherDel = await callWorker(jsonRequest("/api/staff/protocols/user-templates", { id }, { method: "DELETE", headers: { cookie: other } }), db);
    assert.equal(otherDel.status, 404);

    const denied = await callWorker(jsonRequest("/api/staff/protocols/user-templates",
      { title: "x", baseTemplateKey: "ct_chest", document: {} }, { method: "POST", headers: { cookie: registrar } }), db);
    assert.equal(denied.status, 403);
  });
});

test("editor wires save/apply/delete for personal templates", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /\/api\/staff\/protocols\/user-templates/);
  assert.match(page, /function saveAsTemplate\(\)/);
  assert.match(page, /function applyTemplate\(tpl:UserTemplate\)/);
  // Застосування підтверджується, якщо є вміст (не перезаписуємо мовчки).
  assert.match(page, /window\.confirm\("Застосувати шаблон\?/);
});
