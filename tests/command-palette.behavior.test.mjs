// Командна палітра (⌘K): пошуковий API проти живої схеми + монтаж у shell.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function seed(db, { id, code, name, phone, phoneNorm, org = 1 }) {
  await db.prepare(
    `INSERT INTO bookings (id, code, name, phone, phone_normalized, service, service_code,
       desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, code, name, phone, phoneNorm, "КТ", "CT-01", "2026-09-01", "10:00", "new", "1990-05-05", "civilian", org).run();
}

const search = (db, cookie, q) =>
  callWorker(jsonRequest(`/api/staff/search?q=${encodeURIComponent(q)}`, undefined, { method: "GET", headers: { cookie } }), db);

test("search is staff-only", async () => {
  await withD1(async (db) => {
    const res = await callWorker(jsonRequest("/api/staff/search?q=іван", undefined, { method: "GET" }), db);
    assert.equal(res.status, 403);
  });
});

test("search matches by name, phone and RD code", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 1, code: "RD-AAAA1111", name: "Іваненко Іван", phone: "+380971112233", phoneNorm: "380971112233" });
    await seed(db, { id: 2, code: "RD-BBBB2222", name: "Петренко Петро", phone: "+380975556677", phoneNorm: "380975556677" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });

    const byName = await (await search(db, cookie, "іваненко")).json();
    assert.equal(byName.results.length, 1);
    assert.equal(byName.results[0].code, "RD-AAAA1111");

    const byCode = await (await search(db, cookie, "bbbb2222")).json();
    assert.equal(byCode.results.length, 1);
    assert.equal(byCode.results[0].code, "RD-BBBB2222");

    const byPhone = await (await search(db, cookie, "0971112233")).json();
    assert.ok(byPhone.results.some((r) => r.code === "RD-AAAA1111"));
    // Людський підпис статусу присутній.
    assert.ok(byPhone.results[0].statusLabel);
  });
});

test("a query shorter than 2 chars returns nothing (no full-table dump)", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 3, code: "RD-CCCC3333", name: "Сидоренко", phone: "+380971110000", phoneNorm: "380971110000" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await search(db, cookie, "і");
    const data = await res.json();
    assert.equal(data.results.length, 0);
  });
});

test("search never leaks bookings from another organization", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2,'other','Інша',1)").run();
    await seed(db, { id: 4, code: "RD-OWN00001", name: "Шевченко", phone: "+380971110001", phoneNorm: "380971110001", org: 1 });
    await seed(db, { id: 5, code: "RD-OTHER0001", name: "Шевченко", phone: "+380971110002", phoneNorm: "380971110002", org: 2 });
    const cookie = await seedStaffSession(db, { email: "admin@likarnya.test", role: "admin" }); // авто-онбординг у org 1
    const data = await (await search(db, cookie, "шевченко")).json();
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].code, "RD-OWN00001");
  });
});

test("the palette is mounted in the workspace shell and opens on Ctrl/⌘+K", async () => {
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /import CommandPalette from "\.\/command-palette"/);
  assert.match(shell, /<CommandPalette \/>/);
  const cp = await read("app/staff/command-palette.tsx");
  assert.match(cp, /e\.metaKey \|\| e\.ctrlKey/);
  assert.match(cp, /\/api\/staff\/search/);
  assert.match(cp, /\/staff\?open=\$\{b\.id\}/); // заявка → повна картка
});
