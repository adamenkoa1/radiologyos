import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = fs.readFileSync("drizzle/0110_personnel_radiation_clearance.sql", "utf8");
const api = fs.readFileSync("app/api/staff/personnel/radiation-clearance/route.ts", "utf8");
const page = fs.readFileSync("app/staff/personnel/radiation-clearance/page.tsx", "utf8");
const directories = fs.readFileSync("app/staff/directories/page.tsx", "utf8");

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT ''
    );
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

function insertClearance(db, {
  id,
  organizationId,
  personnelId,
  effectiveDate = "2026-08-21",
  decisionCode = "authorized",
  scopeText = "Рентгенографія",
  supersedesId = null,
}) {
  db.prepare(`
    INSERT INTO personnel_radiation_clearance_records
      (id, organization_id, personnel_id, effective_date, decision_code, scope_text, supersedes_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'test@example.test')
  `).run(id, organizationId, personnelId, effectiveDate, decisionCode, scopeText, supersedesId);
}

test("radiation clearance migration enforces tenant and personnel scope", () => {
  const db = createDatabase();
  insertClearance(db, { id:"r1", organizationId:1, personnelId:"personnel-1" });

  assert.throws(
    () => insertClearance(db, { id:"cross-personnel", organizationId:1, personnelId:"personnel-2" }),
    /personnel_radiation_clearance_personnel_scope/,
  );

  insertClearance(db, { id:"org2-r1", organizationId:2, personnelId:"personnel-2" });
  assert.throws(
    () => insertClearance(db, {
      id:"cross-supersedes",
      organizationId:1,
      personnelId:"personnel-1",
      supersedesId:"org2-r1",
    }),
    /personnel_radiation_clearance_supersedes_scope/,
  );

  assert.throws(
    () => insertClearance(db, {
      id:"wrong-person-supersedes",
      organizationId:1,
      personnelId:"personnel-3",
      supersedesId:"r1",
    }),
    /personnel_radiation_clearance_supersedes_scope/,
  );
});

test("radiation clearance history is append-only and corrections form one chain", () => {
  const db = createDatabase();
  insertClearance(db, { id:"r1", organizationId:1, personnelId:"personnel-1" });
  insertClearance(db, {
    id:"r2",
    organizationId:1,
    personnelId:"personnel-1",
    decisionCode:"suspended",
    scopeText:"",
    supersedesId:"r1",
  });

  assert.throws(
    () => insertClearance(db, {
      id:"r3",
      organizationId:1,
      personnelId:"personnel-1",
      decisionCode:"revoked",
      scopeText:"",
      supersedesId:"r1",
    }),
    /UNIQUE constraint failed: personnel_radiation_clearance_records\.supersedes_id/,
  );

  assert.throws(
    () => db.prepare("UPDATE personnel_radiation_clearance_records SET scope_text = 'changed' WHERE id = 'r1'").run(),
    /personnel_radiation_clearance_append_only/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM personnel_radiation_clearance_records WHERE id = 'r1'").run(),
    /personnel_radiation_clearance_append_only/,
  );
});

test("radiation clearance API is manager-only, audited and does not enforce clinical access", () => {
  assert.match(api, /requireSelfServiceOrgContext/);
  assert.match(api, /role === "admin" \|\| role === "department_head"/);
  assert.match(api, /personnel_radiation_clearance_viewed/);
  assert.match(api, /personnel_radiation_clearance_recorded/);
  assert.match(api, /organization_id = \?/);
  assert.match(api, /personnel_id = \?/);
  assert.match(api, /supersedes_id/);
  assert.doesNotMatch(api, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(api, /imaging_studies|pacs_settings|bookings|canManageImaging/);
});

test("radiation clearance UI keeps VLK, training, dosimetry and operational enforcement separate", () => {
  assert.match(page, /personnelId/);
  assert.match(page, /Допуск персоналу до ДІВ/);
  assert.match(page, /Append-only/);
  assert.match(page, /supersedesId/);
  assert.match(page, /scopeText/);
  assert.match(page, /дозиметр/i);
  assert.match(page, /operational gate/i);
  assert.doesNotMatch(page, /ВЛК/);
  assert.match(directories, /Допуск до ДІВ/);
  assert.match(directories, /\/staff\/personnel\/radiation-clearance/);
});
