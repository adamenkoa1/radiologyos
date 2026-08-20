import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const migration = read("drizzle/0109_personnel_vlk_history.sql");
const api = read("app/api/staff/personnel/vlk/route.ts");
const page = read("app/staff/personnel/vlk/page.tsx");
const directories = read("app/staff/directories/page.tsx");

function baseline() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE personnel_records (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '',
      department_id INTEGER,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
    INSERT INTO organizations (id, name) VALUES (1, 'Hospital One'), (2, 'Hospital Two');
    INSERT INTO personnel_records (id, organization_id, display_name, position_title)
      VALUES ('personnel-1', 1, 'Працівник Один', 'Лікар'),
             ('personnel-2', 2, 'Працівник Два', 'Лікар');
  `);
  db.exec(migration);
  return db;
}

test("VLK history is organization-scoped and append-only", () => {
  const db = baseline();
  db.prepare(`INSERT INTO personnel_vlk_records
    (id, organization_id, personnel_id, examination_date, decision_code, decision_text, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("vlk-1", 1, "personnel-1", "2026-08-20", "fit", "Придатний", "admin@example.test");

  assert.throws(() => db.prepare(`INSERT INTO personnel_vlk_records
    (id, organization_id, personnel_id, examination_date, decision_code, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("vlk-cross", 1, "personnel-2", "2026-08-20", "fit", "admin@example.test"), /personnel_vlk_personnel_scope/);

  assert.throws(() => db.prepare("UPDATE personnel_vlk_records SET decision_code = 'unfit' WHERE id = 'vlk-1'").run(), /personnel_vlk_append_only/);
  assert.throws(() => db.prepare("DELETE FROM personnel_vlk_records WHERE id = 'vlk-1'").run(), /personnel_vlk_append_only/);
  db.close();
});

test("VLK corrections supersede exactly one record without rewriting history", () => {
  const db = baseline();
  const insert = db.prepare(`INSERT INTO personnel_vlk_records
    (id, organization_id, personnel_id, examination_date, decision_code, decision_text, supersedes_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run("vlk-original", 1, "personnel-1", "2026-08-20", "fit", "Початкове рішення", null, "admin@example.test");
  insert.run("vlk-correction", 1, "personnel-1", "2026-08-21", "other", "Уточнене рішення", "vlk-original", "admin@example.test");

  const original = db.prepare("SELECT decision_text AS decisionText FROM personnel_vlk_records WHERE id = 'vlk-original'").get();
  assert.equal(original.decisionText, "Початкове рішення");
  assert.throws(() => insert.run("vlk-branch", 1, "personnel-1", "2026-08-22", "fit", "Ще одне", "vlk-original", "admin@example.test"), /UNIQUE constraint failed/);
  assert.throws(() => insert.run("vlk-cross", 2, "personnel-2", "2026-08-22", "fit", "Cross", "vlk-original", "admin@example.test"), /personnel_vlk_supersedes_scope/);
  db.close();
});

test("VLK API is manager-only, tenant-scoped, audited and has no mutation endpoint for old records", () => {
  assert.match(api, /requireSelfServiceOrgContext\(request, db\)/);
  assert.match(api, /role === "admin" \|\| role === "department_head"/);
  assert.match(api, /WHERE id = \? AND organization_id = \?/);
  assert.match(api, /r\.organization_id = \? AND r\.personnel_id = \?/);
  assert.match(api, /action: "personnel_vlk_viewed"/);
  assert.match(api, /action: "personnel_vlk_recorded"/);
  assert.match(api, /details: \{ recordCount: records\.results\.length \}/);
  assert.doesNotMatch(api, /export async function (PATCH|PUT|DELETE)/);
  assert.doesNotMatch(api, /diagnos|діагноз/i);
});

test("VLK UI keeps medical fitness separate from account identity and radiation clearance", () => {
  assert.match(page, /\/api\/staff\/personnel\/vlk/);
  assert.match(page, /Append-only/);
  assert.match(page, /без діагнозів у кадровому реєстрі/);
  assert.match(page, /Виправлення ВЛК додано без зміни попереднього запису/);
  assert.match(page, /Скан документа в цьому блоці не зберігається/);
  assert.doesNotMatch(page, /допуск до ДІВ|радіаційн/i);
  assert.match(directories, /href:"\/staff\/personnel\/vlk"/);
});
