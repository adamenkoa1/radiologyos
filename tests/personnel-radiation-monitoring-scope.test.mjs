import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migration = fs.readFileSync("drizzle/0114_personnel_radiation_monitoring_scope.sql", "utf8");
const route = fs.readFileSync("app/api/staff/personnel/radiation-monitoring-scope/route.ts", "utf8");
const page = fs.readFileSync("app/staff/personnel/radiation-monitoring-scope/page.tsx", "utf8");
const directories = fs.readFileSync("app/staff/directories/page.tsx", "utf8");
const audit = fs.readFileSync("lib/audit.ts", "utf8");

function baselineDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (id INTEGER PRIMARY KEY);
    CREATE TABLE personnel_records (
      id TEXT PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO organizations(id) VALUES (1), (2);
    INSERT INTO personnel_records(id, organization_id, display_name, position_title) VALUES
      ('p1', 1, 'Працівник Один', 'Лікар'),
      ('p2', 1, 'Працівник Два', 'Лаборант'),
      ('p3', 2, 'Інший Tenant', 'Лікар');
  `);
  db.exec(migration);
  return db;
}

test("monitoring scope enforces tenant references and semantic checks", () => {
  const db = baselineDb();

  db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status, scope_text)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("s1", 1, "p1", "2026-08-21", "in_scope", "КТ та рентгенографія");

  assert.throws(() => db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status, scope_text)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("empty-scope", 1, "p2", "2026-08-21", "in_scope", ""));

  assert.throws(() => db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status, note)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("other-without-note", 1, "p2", "2026-08-21", "other", ""));

  assert.throws(() => db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status)
    VALUES (?, ?, ?, ?, ?)`)
    .run("cross-personnel", 1, "p3", "2026-08-21", "out_of_scope"), /personnel_radiation_monitoring_scope_personnel_scope/);
});

test("monitoring scope is append-only and corrections are single-successor tenant scoped", () => {
  const db = baselineDb();
  db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status, scope_text)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("original", 1, "p1", "2026-08-01", "in_scope", "КТ");

  db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status, supersedes_id)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("correction", 1, "p1", "2026-08-01", "out_of_scope", "original");

  assert.throws(() => db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status, supersedes_id)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("second-correction", 1, "p1", "2026-08-01", "out_of_scope", "original"), /UNIQUE constraint failed/);

  db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status)
    VALUES (?, ?, ?, ?, ?)`)
    .run("tenant-two", 2, "p3", "2026-08-01", "out_of_scope");

  assert.throws(() => db.prepare(`INSERT INTO personnel_radiation_monitoring_scope_records
    (id, organization_id, personnel_id, effective_date, scope_status, supersedes_id)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("cross-supersedes", 1, "p1", "2026-08-02", "out_of_scope", "tenant-two"), /personnel_radiation_monitoring_scope_supersedes_scope/);

  assert.throws(() => db.prepare("UPDATE personnel_radiation_monitoring_scope_records SET note = 'x' WHERE id = 'original'").run(), /append_only/);
  assert.throws(() => db.prepare("DELETE FROM personnel_radiation_monitoring_scope_records WHERE id = 'original'").run(), /append_only/);
});

test("monitoring scope API is manager-only, tenant-scoped and has no operational enforcement", () => {
  assert.match(route, /role === "admin" \|\| role === "department_head"/);
  assert.match(route, /WHERE id = \? AND organization_id = \? LIMIT 1/);
  assert.match(route, /r\.organization_id = \? AND r\.personnel_id = \?/);
  assert.match(route, /personnel_radiation_monitoring_scope_viewed/);
  assert.match(route, /personnel_radiation_monitoring_scope_recorded/);
  assert.match(route, /scopeStatus === "in_scope" && !scopeText/);
  assert.match(route, /scopeStatus === "other" && !note/);
  assert.doesNotMatch(route, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /pacs_settings|imaging_studies|bookings|work_lock|access_denied/);
});

test("monitoring scope UI is explicit organizational classification, not legal inference", () => {
  assert.match(page, /не автоматична правова категоризація/);
  assert.match(page, /без inference з посади чи дозиметра/);
  assert.match(page, /`in_scope` не є автоматичним дозволом на роботу з ДІВ/);
  assert.match(page, /`out_of_scope` не є юридичним або медичним звільненням/);
  assert.match(page, /Append-only/);
  assert.match(directories, /Контингент радіаційного контролю/);
  assert.match(directories, /\/staff\/personnel\/radiation-monitoring-scope/);
  assert.match(audit, /personnel_radiation_monitoring_scope_viewed/);
  assert.match(audit, /personnel_radiation_monitoring_scope_recorded/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+personnel_radiation_monitoring_scope_records/i);
});
