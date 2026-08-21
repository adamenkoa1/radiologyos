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
  const match = route.match(/db\.prepare\(\s*`(WITH clearance_ranked[\s\S]*?ORDER BY p\.last_name, p\.first_name, p\.patronymic, p\.id)`\s*,?\s*\)\.bind/);
  assert.ok(match, "projection SQL must remain extractable for behavioral coverage");
  return match[1];
}

function effectivePolicySql() {
  const match = route.match(/rawPolicy = await db\.prepare\(\s*`(SELECT r\.id,[\s\S]*?LIMIT 1)`\s*,?\s*\)\.bind/);
  assert.ok(match, "effective policy SQL must remain extractable for behavioral coverage");
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
    INSERT INTO departments(id, organization_id, name) VALUES (10, 1, 'Рентгенологія'), (20, 2, 'Інша');
    INSERT INTO personnel_records
      (id, organization_id, display_name, position_title, department_id, active, last_name, first_name)
    VALUES
      ('p1', 1, 'Тест Один', 'Лікар', 10, 1, 'Тест', 'Один'),
      ('p2', 1, 'Тест Неактивний', 'Лікар', 10, 0, 'Тест', 'Неактивний'),
      ('p3', 2, 'Інший Tenant', 'Лікар', 20, 1, 'Інший', 'Tenant');
  `);
  for (const migration of [
    "drizzle/0110_personnel_radiation_clearance.sql",
    "drizzle/0111_personnel_radiation_training.sql",
    "drizzle/0112_personnel_dosimetry.sql",
    "drizzle/0113_personnel_radiation_review_policy.sql",
  ]) db.exec(fs.readFileSync(migration, "utf8"));
  return db;
}

test("compliance projection selects current unsuperseded tenant-scoped facts", () => {
  const db = baselineDb();

  db.exec(`
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

  const asOf = "2026-08-21";
  const rows = db.prepare(projectionSql()).all(1, asOf, 1, asOf, 1, asOf, 1, asOf, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].personnelId, "p1");
  assert.equal(rows[0].clearanceDecisionCode, "revoked");
  assert.equal(rows[0].trainingResultCode, "completed");
  assert.equal(rows[0].knowledgeResultCode, "failed");
  assert.equal(rows[0].dosimetryMeasurementStatus, "measured");
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

test("projection endpoint is read-only, manager-only and does not duplicate dose values", () => {
  assert.match(route, /role === "admin" \|\| role === "department_head"/);
  assert.match(route, /personnel_radiation_compliance_viewed/);
  assert.match(route, /p\.organization_id = \? AND p\.active = 1/);
  assert.match(route, /effective_from <= \?/);
  assert.match(route, /ORDER BY r\.effective_from DESC, r\.created_at DESC, r\.id DESC/);
  assert.match(route, /radiationPolicyReviewReasons/);
  assert.match(route, /policyReviewCount/);
  assert.match(route, /training_kind = 'radiation_safety'/);
  assert.match(route, /training_kind = 'knowledge_check'/);
  assert.match(route, /period_end <= \?/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /hp10_msv|hp007_msv|hp3_msv/);
  assert.doesNotMatch(route, /pacs_settings|imaging_studies|bookings/);
});

test("policy review helper adds configured age reasons without legal compliance claims", () => {
  assert.match(helper, /radiationPolicyReviewReasons/);
  assert.match(helper, /age > policy\.trainingMaxAgeDays/);
  assert.match(helper, /age > policy\.knowledgeCheckMaxAgeDays/);
  assert.match(helper, /age > policy\.dosimetryMaxAgeDays/);
  assert.match(helper, /немає запису перевірки знань/);
  assert.match(helper, /mergeRadiationReviewReasons/);
  assert.match(helper, /authorized_unknown_expiry/);
  assert.match(helper, /Останній дозиметричний результат відсутній/);
  assert.doesNotMatch(helper, /compliant|noncompliant|doseLimit|annualLimit/i);
});

test("overview UI exposes applied policy but remains informational", () => {
  assert.match(page, /майбутні policy revisions не включаються/);
  assert.match(page, /не автоматичне рішення про допуск до роботи/);
  assert.match(page, /не створює alerts/);
  assert.match(page, /не блокує PACS, КТ, рентген або запис пацієнтів/);
  assert.match(page, /Застосована policy revision/);
  assert.match(page, /policyReviewCount/);
  assert.match(page, /Історія політики/);
  assert.match(page, /Без очевидних зауважень/);
  assert.match(directories, /Зведення ДІВ/);
  assert.match(directories, /\/staff\/personnel\/radiation-compliance/);
  assert.match(audit, /personnel_radiation_compliance_viewed/);
});
