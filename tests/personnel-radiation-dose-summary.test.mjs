import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const route = fs.readFileSync("app/api/staff/personnel/radiation-dose-summary/route.ts", "utf8");
const page = fs.readFileSync("app/staff/personnel/radiation-dose-summary/page.tsx", "utf8");
const directories = fs.readFileSync("app/staff/directories/page.tsx", "utf8");
const audit = fs.readFileSync("lib/audit.ts", "utf8");

function summarySql() {
  const match = route.match(/db\.prepare\(\s*`(WITH current_records[\s\S]*?ORDER BY p\.last_name, p\.first_name, p\.patronymic, p\.id)`\s*,?\s*\)\.bind/);
  assert.ok(match, "dose summary SQL must remain extractable for behavioral coverage");
  return match[1];
}

function baselineDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (id INTEGER PRIMARY KEY);
    CREATE TABLE departments (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE personnel_records (
      id TEXT PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      position_title TEXT NOT NULL,
      department_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      last_name TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      patronymic TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO organizations(id) VALUES (1), (2);
    INSERT INTO departments(id, organization_id, name) VALUES
      (10, 1, 'Рентгенологія'),
      (20, 2, 'Інша');
    INSERT INTO personnel_records
      (id, organization_id, display_name, position_title, department_id, active, last_name, first_name)
    VALUES
      ('p1', 1, 'Тест Один', 'Лікар', 10, 1, 'Тест', 'Один'),
      ('p2', 1, 'Тест Два', 'Лаборант', 10, 1, 'Тест', 'Два'),
      ('p3', 2, 'Інший Tenant', 'Лікар', 20, 1, 'Інший', 'Tenant');
  `);
  for (const migration of [
    "drizzle/0112_personnel_dosimetry.sql",
    "drizzle/0114_personnel_radiation_monitoring_scope.sql",
  ]) db.exec(fs.readFileSync(migration, "utf8"));
  return db;
}

test("dose summary preserves measured history while adding effective-dated monitoring scope", () => {
  const db = baselineDb();
  db.exec(`
    INSERT INTO personnel_dosimetry_records
      (id, organization_id, personnel_id, period_start, period_end, measurement_status, hp10_msv, hp007_msv, hp3_msv)
    VALUES
      ('d-old', 1, 'p1', '2026-01-01', '2026-01-31', 'measured', 0.10, 0.20, 0.30);

    INSERT INTO personnel_dosimetry_records
      (id, organization_id, personnel_id, period_start, period_end, measurement_status, hp10_msv, hp007_msv, hp3_msv, supersedes_id)
    VALUES
      ('d-corrected', 1, 'p1', '2026-01-01', '2026-01-31', 'measured', 0.15, 0.25, 0.35, 'd-old');

    INSERT INTO personnel_dosimetry_records
      (id, organization_id, personnel_id, period_start, period_end, measurement_status, hp10_msv, hp007_msv, hp3_msv)
    VALUES
      ('d-below', 1, 'p1', '2026-02-01', '2026-02-28', 'below_detection', 0, 0, 0),
      ('d-missing', 1, 'p1', '2026-03-01', '2026-03-31', 'missing', 0, 0, 0),
      ('d-other', 1, 'p1', '2026-04-01', '2026-04-30', 'other', 9, 8, 7),
      ('d-p2-measured', 1, 'p2', '2026-05-01', '2026-05-31', 'measured', 0.40, 0.50, 0.60),
      ('d-outside', 1, 'p1', '2025-12-01', '2025-12-31', 'measured', 99, 99, 99),
      ('d-other-tenant', 2, 'p3', '2026-01-01', '2026-01-31', 'measured', 100, 100, 100);

    INSERT INTO personnel_radiation_monitoring_scope_records
      (id, organization_id, personnel_id, effective_date, scope_status, scope_text)
    VALUES
      ('scope-p1-current', 1, 'p1', '2026-01-01', 'in_scope', 'Персональний дозиметричний контроль'),
      ('scope-p2-out', 1, 'p2', '2026-01-01', 'out_of_scope', ''),
      ('scope-other-tenant', 2, 'p3', '2026-01-01', 'in_scope', 'Інший tenant');

    INSERT INTO personnel_radiation_monitoring_scope_records
      (id, organization_id, personnel_id, effective_date, scope_status, scope_text, supersedes_id)
    VALUES
      ('scope-p1-future', 1, 'p1', '2027-01-01', 'out_of_scope', '', 'scope-p1-current');
  `);

  const sql = summarySql();
  const rows2026 = db.prepare(sql).all(
    1, "2026-01-01", "2026-12-31",
    1, "2026-12-31", "2026-12-31",
    1,
  );
  assert.equal(rows2026.length, 2);

  const p1 = rows2026.find((row) => row.personnelId === "p1");
  const p2 = rows2026.find((row) => row.personnelId === "p2");
  assert.ok(p1);
  assert.ok(p2);

  assert.equal(p1.monitoringScopeStatus, "in_scope");
  assert.equal(p1.monitoringScopeEffectiveDate, "2026-01-01");
  assert.equal(p1.measuredCount, 1);
  assert.equal(p1.belowDetectionCount, 1);
  assert.equal(p1.missingCount, 1);
  assert.equal(p1.otherCount, 1);
  assert.equal(p1.hp10MeasuredSubtotal, 0.15);
  assert.equal(p1.hp007MeasuredSubtotal, 0.25);
  assert.equal(p1.hp3MeasuredSubtotal, 0.35);
  assert.equal(p1.firstPeriodStart, "2026-01-01");
  assert.equal(p1.lastPeriodEnd, "2026-04-30");

  assert.equal(p2.monitoringScopeStatus, "out_of_scope");
  assert.equal(p2.measuredCount, 1);
  assert.equal(p2.hp10MeasuredSubtotal, 0.40);
  assert.equal(p2.hp007MeasuredSubtotal, 0.50);
  assert.equal(p2.hp3MeasuredSubtotal, 0.60);
  assert.equal(rows2026.some((row) => row.personnelId === "p3"), false);

  const rows2027 = db.prepare(sql).all(
    1, "2026-01-01", "2027-12-31",
    1, "2027-12-31", "2027-12-31",
    1,
  );
  const p1AfterFutureCorrection = rows2027.find((row) => row.personnelId === "p1");
  assert.ok(p1AfterFutureCorrection);
  assert.equal(p1AfterFutureCorrection.monitoringScopeStatus, "out_of_scope");
  assert.equal(p1AfterFutureCorrection.hp10MeasuredSubtotal, 0.15);
});

test("dose summary endpoint is manager-only, read-only, measured-only and does not filter dose by scope", () => {
  assert.match(route, /role === "admin" \|\| role === "department_head"/);
  assert.match(route, /measurement_status = 'measured' THEN hp10_msv ELSE 0/);
  assert.match(route, /measurement_status = 'below_detection'/);
  assert.match(route, /measurement_status = 'missing'/);
  assert.match(route, /measurement_status = 'other'/);
  assert.match(route, /monitoring_scope_ranked/);
  assert.match(route, /correction\.effective_date <= \?/);
  assert.match(route, /ms\.scope_status AS monitoringScopeStatus/);
  assert.match(route, /scopeAsOf:to/);
  assert.match(route, /r\.period_end >= \? AND r\.period_end <= \?/);
  assert.match(route, /p\.organization_id = \? AND p\.active = 1/);
  assert.match(route, /personnel_radiation_dose_summary_viewed/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /pacs_settings|imaging_studies|bookings/);
  assert.doesNotMatch(route, /hp10_measured_subtotal\s*[<>]=?\s*\d/);
  assert.doesNotMatch(route, /WHERE[^`]*scope_status\s*=\s*['"]in_scope['"]/i);
});

test("dose summary UI keeps historical dose visible regardless of monitoring scope", () => {
  assert.match(page, /below_detection` не є нульовою дозою/);
  assert.match(page, /missing` не означає нульове опромінення/);
  assert.match(page, /other` не включається до subtotal/);
  assert.match(page, /numericSubtotalAvailable/);
  assert.match(page, /available \? `\$\{String\(Number\(value \|\| 0\)\)\} mSv` : "—"/);
  assert.match(page, /не приховують і не обнуляють історичні дозиметричні записи чи measured subtotal/);
  assert.match(page, /scope не фільтрує історичні дози/);
  assert.match(page, /Історія контингенту/);
  assert.match(page, /не розрахунок нормативної річної\/ковзної дози/);
  assert.match(page, /немає dose thresholds/);
  assert.match(directories, /Дозове зведення/);
  assert.match(directories, /\/staff\/personnel\/radiation-dose-summary/);
  assert.match(audit, /personnel_radiation_dose_summary_viewed/);
});
