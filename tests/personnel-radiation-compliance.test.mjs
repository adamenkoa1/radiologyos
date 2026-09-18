import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const route = fs.readFileSync("app/api/staff/personnel/radiation-compliance/route.ts", "utf8");
const helper = fs.readFileSync("lib/personnel-radiation-compliance.ts", "utf8");
const page = fs.readFileSync("app/staff/personnel/radiation-compliance/page.tsx", "utf8");
const directories = fs.readFileSync("app/staff/directories/page.tsx", "utf8");
const audit = fs.readFileSync("lib/audit.ts", "utf8");

function projectionSql() {
  const match = route.match(/db\.prepare\(\s*`(WITH monitoring_scope_ranked[\s\S]*?ORDER BY p\.last_name, p\.first_name, p\.patronymic, p\.id)`\s*,?\s*\)\.bind/);
  assert.ok(match, "projection SQL must remain extractable for behavioral coverage");
  return match[1];
}

function effectivePolicySql() {
  const match = route.match(/rawPolicy = await db\.prepare\(\s*`(SELECT r\.id,[\s\S]*?LIMIT 1)`\s*,?\s*\)\.bind/);
  assert.ok(match, "effective policy SQL must remain extractable for behavioral coverage");
  return match[1];
}

function projectionRows(db, asOf) {
  return db.prepare(projectionSql()).all(
    1, asOf, asOf,
    1, asOf,
    1, asOf,
    1, asOf,
    1, asOf,
    1,
  );
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
    INSERT INTO departments(id, organization_id, name) VALUES (10, 1, 'Рентгенологія'), (20, 2, 'Інша');
    INSERT INTO personnel_records
      (id, organization_id, display_name, position_title, department_id, active, last_name, first_name)
    VALUES
      ('p1', 1, 'Тест Один', 'Лікар', 10, 1, 'Тест', 'Один'),
      ('p2', 1, 'Тест Два', 'Адміністратор', 10, 1, 'Тест', 'Два'),
      ('p4', 1, 'Тест Чотири', 'Працівник', 10, 1, 'Тест', 'Чотири'),
      ('p5', 1, 'Тест Пʼять', 'Працівник', 10, 1, 'Тест', 'Пʼять'),
      ('p3', 2, 'Інший Tenant', 'Лікар', 20, 1, 'Інший', 'Tenant');
  `);
  for (const migration of [
    "drizzle/0110_personnel_radiation_clearance.sql",
    "drizzle/0111_personnel_radiation_training.sql",
    "drizzle/0112_personnel_dosimetry.sql",
    "drizzle/0113_personnel_radiation_review_policy.sql",
    "drizzle/0114_personnel_radiation_monitoring_scope.sql",
  ]) db.exec(fs.readFileSync(migration, "utf8"));
  return db;
}

test("compliance projection selects monitoring scope and current tenant-scoped safety facts", () => {
  const db = baselineDb();

  db.exec(`
    INSERT INTO personnel_radiation_monitoring_scope_records
      (id, organization_id, personnel_id, effective_date, scope_status, scope_text, note)
    VALUES
      ('scope-p1', 1, 'p1', '2026-01-01', 'in_scope', 'КТ', ''),
      ('scope-p2', 1, 'p2', '2026-01-01', 'out_of_scope', '', ''),
      ('scope-p5', 1, 'p5', '2026-01-01', 'other', '', 'Потребує уточнення'),
      ('scope-p3', 2, 'p3', '2026-01-01', 'in_scope', 'КТ', '');

    INSERT INTO personnel_radiation_clearance_records
      (id, organization_id, personnel_id, effective_date, decision_code, scope_text, valid_until)
    VALUES ('c-old', 1, 'p1', '2026-01-10', 'authorized', 'КТ', '2026-12-31');
    INSERT INTO personnel_radiation_clearance_records
      (id, organization_id, personnel_id, effective_date, decision_code, supersedes_id)
    VALUES ('c-correction', 1, 'p1', '2026-01-10', 'revoked', 'c-old');
    INSERT INTO personnel_radiation_clearance_records
      (id, organization_id, personnel_id, effective_date, decision_code, scope_text, valid_until)
    VALUES ('c-future', 1, 'p1', '2027-01-01', 'authorized', 'КТ', '2027-12-31');

    INSERT INTO personnel_radiation_training_records
      (id, organization_id, personnel_id, training_date, training_kind, result_code, course_title, valid_until)
    VALUES
      ('t-safe', 1, 'p1', '2026-02-01', 'radiation_safety', 'completed', 'РБ', '2026-12-31'),
      ('t-future', 1, 'p1', '2027-02-01', 'radiation_safety', 'passed', 'РБ future', '2027-12-31'),
      ('t-knowledge', 1, 'p1', '2026-03-01', 'knowledge_check', 'failed', 'Перевірка', '2026-12-31');

    INSERT INTO personnel_dosimetry_records
      (id, organization_id, personnel_id, period_start, period_end, measurement_status, hp10_msv, hp007_msv, hp3_msv)
    VALUES
      ('d-current', 1, 'p1', '2026-06-01', '2026-06-30', 'measured', 0.12, 0, 0),
      ('d-future', 1, 'p1', '2027-01-01', '2027-01-31', 'missing', 0, 0, 0),
      ('d-other-tenant', 2, 'p3', '2026-06-01', '2026-06-30', 'measured', 1, 0, 0);
  `);

  const rows = projectionRows(db, "2026-08-21");
  assert.equal(rows.length, 4);

  const p1 = rows.find((row) => row.personnelId === "p1");
  const p2 = rows.find((row) => row.personnelId === "p2");
  const p4 = rows.find((row) => row.personnelId === "p4");
  const p5 = rows.find((row) => row.personnelId === "p5");
  assert.equal(p1.monitoringScopeStatus, "in_scope");
  assert.equal(p1.clearanceDecisionCode, "revoked");
  assert.equal(p1.trainingResultCode, "completed");
  assert.equal(p1.knowledgeResultCode, "failed");
  assert.equal(p1.dosimetryMeasurementStatus, "measured");
  assert.equal(p2.monitoringScopeStatus, "out_of_scope");
  assert.equal(p2.clearanceDecisionCode, null);
  assert.equal(p4.monitoringScopeStatus, null);
  assert.equal(p5.monitoringScopeStatus, "other");
  assert.equal(rows.some((row) => row.personnelId === "p3"), false);
});

test("future scope correction does not erase current scope before its effective date", () => {
  const db = baselineDb();
  db.exec(`
    INSERT INTO personnel_radiation_monitoring_scope_records
      (id, organization_id, personnel_id, effective_date, scope_status, scope_text)
    VALUES ('scope-current', 1, 'p1', '2026-01-01', 'in_scope', 'КТ');
    INSERT INTO personnel_radiation_monitoring_scope_records
      (id, organization_id, personnel_id, effective_date, scope_status, supersedes_id)
    VALUES ('scope-future-correction', 1, 'p1', '2027-01-01', 'out_of_scope', 'scope-current');
  `);

  const before = projectionRows(db, "2026-08-21").find((row) => row.personnelId === "p1");
  assert.equal(before.monitoringScopeStatus, "in_scope");
  assert.equal(before.monitoringScopeEffectiveDate, "2026-01-01");

  const after = projectionRows(db, "2027-01-02").find((row) => row.personnelId === "p1");
  assert.equal(after.monitoringScopeStatus, "out_of_scope");
  assert.equal(after.monitoringScopeEffectiveDate, "2027-01-01");
});

test("effective policy selection keeps current revision until future successor takes effect", () => {
  const db = baselineDb();
  db.exec(`
    INSERT INTO personnel_radiation_review_policy_revisions
      (id, organization_id, effective_from, enabled, training_max_age_days, source_title)
    VALUES ('policy-current', 1, '2026-01-01', 1, 180, 'Policy current');
    INSERT INTO personnel_radiation_review_policy_revisions
      (id, organization_id, effective_from, enabled, training_max_age_days, source_title, supersedes_id)
    VALUES ('policy-future', 1, '2027-01-01', 0, NULL, 'Policy future', 'policy-current');
  `);

  const sql = effectivePolicySql();
  const before = db.prepare(sql).get(1, "2026-08-21");
  assert.equal(before.id, "policy-current");
  assert.equal(before.enabled, 1);
  assert.equal(before.trainingMaxAgeDays, 180);

  const after = db.prepare(sql).get(1, "2027-01-02");
  assert.equal(after.id, "policy-future");
  assert.equal(after.enabled, 0);

  const otherTenant = db.prepare(sql).get(2, "2027-01-02");
  assert.equal(otherTenant, undefined);
  assert.doesNotMatch(sql, /supersedes_id|NOT EXISTS/i);
});

test("scope helper prevents false safety review outside explicit in-scope population", () => {
  assert.match(helper, /RadiationMonitoringScopeState/);
  assert.match(helper, /classifyRadiationMonitoringScope/);
  assert.match(helper, /scopeStatus === "in_scope"/);
  assert.match(helper, /scopeStatus === "out_of_scope"/);
  assert.match(helper, /return "unclassified"/);
  assert.match(helper, /Не визначено контур радіаційного контролю/);
  assert.match(helper, /Організаційний контур радіаційного контролю потребує уточнення/);
  assert.match(route, /monitoringScopeState === "in_scope" \? radiationReviewReasons/);
  assert.match(route, /monitoringScopeState === "in_scope" \? radiationPolicyReviewReasons/);
  assert.match(route, /monitoringScopeState === "out_of_scope"[\s\S]*?"out_of_scope"/);
});

test("projection endpoint remains read-only, tenant-scoped and has no operational enforcement", () => {
  assert.match(route, /role === "admin" \|\| role === "department_head"/);
  assert.match(route, /WITH monitoring_scope_ranked AS/);
  assert.match(route, /correction\.effective_date <= \?/);
  assert.match(route, /LEFT JOIN monitoring_scope_ranked ms/);
  assert.match(route, /p\.organization_id = \? AND p\.active = 1/);
  assert.match(route, /effective_from <= \?/);
  assert.match(route, /radiationPolicyReviewReasons/);
  assert.match(route, /scopeReviewCount/);
  assert.match(route, /outOfScopeCount/);
  assert.match(route, /personnel_radiation_compliance_viewed/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /hp10_msv|hp007_msv|hp3_msv/);
  assert.doesNotMatch(route, /pacs_settings|imaging_studies|bookings|work_lock|access_denied/);
});

test("overview UI shows scope separately and masks safety statuses outside in-scope", () => {
  assert.match(page, /monitoringScopeState/);
  assert.match(page, /У контурі/);
  assert.match(page, /Поза контуром/);
  assert.match(page, /Не визначено/);
  assert.match(page, /const evaluate=record\.monitoringScopeState==="in_scope"/);
  assert.match(page, /Не оцінюється/);
  assert.match(page, /не генерує фальшивих «відсутній допуск\/дозиметрія»/);
  assert.match(page, /це тільки організаційна класифікація RadiologyOS/);
  assert.match(page, /не юридичне чи медичне звільнення/);
  assert.match(page, /не створює alerts/);
  assert.match(page, /не блокує PACS, КТ, рентген або запис пацієнтів/);
  assert.match(page, /\/staff\/personnel\/radiation-monitoring-scope/);
  assert.match(directories, /Зведення ДІВ/);
  assert.match(audit, /personnel_radiation_compliance_viewed/);
});
