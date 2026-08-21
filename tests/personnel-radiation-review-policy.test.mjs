import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migration = fs.readFileSync("drizzle/0113_personnel_radiation_review_policy.sql", "utf8");
const api = fs.readFileSync("app/api/staff/personnel/radiation-review-policy/route.ts", "utf8");
const page = fs.readFileSync("app/staff/personnel/radiation-review-policy/page.tsx", "utf8");
const directories = fs.readFileSync("app/staff/directories/page.tsx", "utf8");
const audit = fs.readFileSync("lib/audit.ts", "utf8");

function dbWithMigration() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (id INTEGER PRIMARY KEY);
    INSERT INTO organizations(id) VALUES (1), (2);
  `);
  db.exec(migration);
  return db;
}

function insertPolicy(db, values = {}) {
  const row = {
    id: values.id || "policy-root",
    organizationId: values.organizationId ?? 1,
    effectiveFrom: values.effectiveFrom || "2026-08-21",
    enabled: values.enabled ?? 0,
    requireClearanceValidUntil: values.requireClearanceValidUntil ?? 0,
    trainingMaxAgeDays: values.trainingMaxAgeDays ?? null,
    knowledgeCheckMaxAgeDays: values.knowledgeCheckMaxAgeDays ?? null,
    dosimetryMaxAgeDays: values.dosimetryMaxAgeDays ?? null,
    sourceTitle: values.sourceTitle || "",
    sourceReference: values.sourceReference || "",
    note: values.note || "",
    supersedesId: values.supersedesId ?? null,
  };
  db.prepare(`
    INSERT INTO personnel_radiation_review_policy_revisions
      (id, organization_id, effective_from, enabled,
       require_clearance_valid_until, training_max_age_days,
       knowledge_check_max_age_days, dosimetry_max_age_days,
       source_title, source_reference, note, supersedes_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.organizationId, row.effectiveFrom, row.enabled,
    row.requireClearanceValidUntil, row.trainingMaxAgeDays,
    row.knowledgeCheckMaxAgeDays, row.dosimetryMaxAgeDays,
    row.sourceTitle, row.sourceReference, row.note, row.supersedesId,
  );
}

test("radiation review policy is one append-only linear history per organization", () => {
  const db = dbWithMigration();
  insertPolicy(db, { id:"root", organizationId:1 });

  assert.throws(
    () => insertPolicy(db, { id:"second-root", organizationId:1 }),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => insertPolicy(db, { id:"cross-tenant", organizationId:2, supersedesId:"root" }),
    /personnel_radiation_review_policy_supersedes_scope/,
  );
  assert.throws(
    () => insertPolicy(db, { id:"backdated", organizationId:1, effectiveFrom:"2026-08-20", supersedesId:"root" }),
    /personnel_radiation_review_policy_effective_order/,
  );

  insertPolicy(db, {
    id:"revision-2",
    organizationId:1,
    effectiveFrom:"2026-09-01",
    enabled:1,
    requireClearanceValidUntil:1,
    trainingMaxAgeDays:365,
    supersedesId:"root",
    sourceTitle:"Внутрішня політика",
  });

  assert.throws(
    () => insertPolicy(db, { id:"parallel", organizationId:1, effectiveFrom:"2026-10-01", supersedesId:"root" }),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => db.prepare("UPDATE personnel_radiation_review_policy_revisions SET enabled = 0 WHERE id = 'revision-2'").run(),
    /personnel_radiation_review_policy_append_only/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM personnel_radiation_review_policy_revisions WHERE id = 'revision-2'").run(),
    /personnel_radiation_review_policy_append_only/,
  );
});

test("radiation review policy bounds configured ages but has no seeded normative values", () => {
  const db = dbWithMigration();
  assert.throws(
    () => insertPolicy(db, { id:"too-large", trainingMaxAgeDays:36501 }),
    /CHECK constraint failed/,
  );
  assert.doesNotMatch(migration, /INSERT INTO personnel_radiation_review_policy_revisions/i);
  assert.doesNotMatch(migration, /hp10|hp007|hp3|dose_limit|annual_limit/i);
});

test("policy API is tenant-scoped, admin-only for writes and append-only", () => {
  assert.match(api, /role === "admin" \|\| role === "department_head"/);
  assert.match(api, /function canManagePolicy[\s\S]*role === "admin"/);
  assert.match(api, /organization_id = \?/);
  assert.match(api, /personnel_radiation_review_policy_viewed/);
  assert.match(api, /personnel_radiation_review_policy_recorded/);
  assert.match(api, /enabled && !hasCriterion/);
  assert.match(api, /enabled && !sourceTitle/);
  assert.match(api, /supersedesId !== currentLeaf\.id/);
  assert.match(api, /effectiveFrom < currentLeaf\.effectiveFrom/);
  assert.doesNotMatch(api, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(api, /pacs_settings|imaging_studies|bookings/);
  assert.doesNotMatch(api, /hp10|hp007|hp3|doseLimit|annualLimit/i);
});

test("policy UI makes non-normative scope explicit and inherits current leaf values", () => {
  assert.match(page, /без прихованих нормативів/);
  assert.match(page, /не є автоматично нормативними лімітами/);
  assert.match(page, /не блокують PACS, КТ, рентген чи booking/);
  assert.match(page, /thresholds тут навмисно не задаються/);
  assert.match(page, /defaultChecked=\{Boolean\(currentLeaf\?\.enabled\)\}/);
  assert.match(page, /defaultValue=\{currentLeaf\?\.trainingMaxAgeDays \?\? ""\}/);
  assert.match(page, /Форма успадковує поточні значення/);
  assert.match(directories, /Політика ДІВ/);
  assert.match(directories, /\/staff\/personnel\/radiation-review-policy/);
  assert.match(audit, /personnel_radiation_review_policy_viewed/);
  assert.match(audit, /personnel_radiation_review_policy_recorded/);
});
