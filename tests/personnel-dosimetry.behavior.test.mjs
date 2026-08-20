import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = fs.readFileSync("drizzle/0112_personnel_dosimetry.sql", "utf8");
const api = fs.readFileSync("app/api/staff/personnel/dosimetry/route.ts", "utf8");
const page = fs.readFileSync("app/staff/personnel/dosimetry/page.tsx", "utf8");
const directories = fs.readFileSync("app/staff/directories/page.tsx", "utf8");

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
    CREATE TABLE personnel_records (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
    );
    INSERT INTO organizations (id, name) VALUES (1, 'Org One'), (2, 'Org Two');
    INSERT INTO personnel_records (id, organization_id, display_name) VALUES
      ('personnel-1', 1, 'Person One'),
      ('personnel-2', 2, 'Person Two'),
      ('personnel-3', 1, 'Person Three');
  `);
  db.exec(migration);
  return db;
}

function insertDose(db, {
  id,
  organizationId,
  personnelId,
  periodStart = "2026-07-01",
  periodEnd = "2026-07-31",
  measurementStatus = "measured",
  hp10Msv = 0.1,
  hp007Msv = 0,
  hp3Msv = 0,
  supersedesId = null,
}) {
  db.prepare(`
    INSERT INTO personnel_dosimetry_records
      (id, organization_id, personnel_id, period_start, period_end,
       measurement_status, hp10_msv, hp007_msv, hp3_msv, supersedes_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test@example.test')
  `).run(id, organizationId, personnelId, periodStart, periodEnd, measurementStatus, hp10Msv, hp007Msv, hp3Msv, supersedesId);
}

test("dosimetry migration enforces tenant and personnel scope", () => {
  const db = createDatabase();
  insertDose(db, { id:"d1", organizationId:1, personnelId:"personnel-1" });

  assert.throws(
    () => insertDose(db, { id:"cross-personnel", organizationId:1, personnelId:"personnel-2" }),
    /personnel_dosimetry_personnel_scope/,
  );

  insertDose(db, { id:"org2-d1", organizationId:2, personnelId:"personnel-2" });
  assert.throws(
    () => insertDose(db, {
      id:"cross-supersedes",
      organizationId:1,
      personnelId:"personnel-1",
      supersedesId:"org2-d1",
    }),
    /personnel_dosimetry_supersedes_scope/,
  );
  assert.throws(
    () => insertDose(db, {
      id:"wrong-person-supersedes",
      organizationId:1,
      personnelId:"personnel-3",
      supersedesId:"d1",
    }),
    /personnel_dosimetry_supersedes_scope/,
  );
});

test("dosimetry history is append-only and corrections are single-successor", () => {
  const db = createDatabase();
  insertDose(db, { id:"d1", organizationId:1, personnelId:"personnel-1" });
  insertDose(db, { id:"d2", organizationId:1, personnelId:"personnel-1", hp10Msv:0.2, supersedesId:"d1" });

  assert.throws(
    () => insertDose(db, { id:"d3", organizationId:1, personnelId:"personnel-1", hp10Msv:0.3, supersedesId:"d1" }),
    /UNIQUE constraint failed: personnel_dosimetry_records\.supersedes_id/,
  );
  assert.throws(
    () => db.prepare("UPDATE personnel_dosimetry_records SET hp10_msv = 1 WHERE id = 'd1'").run(),
    /personnel_dosimetry_append_only/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM personnel_dosimetry_records WHERE id = 'd1'").run(),
    /personnel_dosimetry_append_only/,
  );
});

test("dosimetry database rejects invalid periods, negative doses and contradictory missing results", () => {
  const db = createDatabase();
  assert.throws(
    () => insertDose(db, { id:"bad-period", organizationId:1, personnelId:"personnel-1", periodStart:"2026-08-01", periodEnd:"2026-07-01" }),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertDose(db, { id:"negative", organizationId:1, personnelId:"personnel-1", hp10Msv:-0.1 }),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertDose(db, { id:"missing-dose", organizationId:1, personnelId:"personnel-1", measurementStatus:"missing", hp10Msv:0.1 }),
    /CHECK constraint failed/,
  );
  assert.doesNotThrow(
    () => insertDose(db, { id:"missing-zero", organizationId:1, personnelId:"personnel-1", measurementStatus:"missing", hp10Msv:0 }),
  );
});

test("dosimetry API is manager-only, audited without dose values and independent of operational access", () => {
  assert.match(api, /requireSelfServiceOrgContext/);
  assert.match(api, /role === "admin" \|\| role === "department_head"/);
  assert.match(api, /personnel_dosimetry_viewed/);
  assert.match(api, /personnel_dosimetry_recorded/);
  assert.match(api, /organization_id = \?/);
  assert.match(api, /personnel_id = \?/);
  assert.match(api, /measurementStatus === "missing"/);
  assert.match(api, /measurementStatus === "below_detection"/);
  assert.doesNotMatch(api, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(api, /imaging_studies|pacs_settings|bookings|canManageImaging/);
  assert.doesNotMatch(api, /details:\s*\{[^}]*hp(?:10|007|3)/is);
});

test("dosimetry UI distinguishes missing and below-detection results from zero dose", () => {
  assert.match(page, /Індивідуальна дозиметрія/);
  assert.match(page, /Hp\(10\)/);
  assert.match(page, /Hp\(0\.07\)/);
  assert.match(page, /Hp\(3\)/);
  assert.match(page, /doseDisplay/);
  assert.match(page, /Нижче межі визначення/);
  assert.match(page, /Результат відсутній/);
  assert.match(page, /alerts і автоматичне обмеження роботи будуть окремим compliance-блоком/);
  assert.match(directories, /Індивідуальна дозиметрія/);
  assert.match(directories, /\/staff\/personnel\/dosimetry/);
});
