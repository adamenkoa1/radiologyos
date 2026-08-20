import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = fs.readFileSync("drizzle/0111_personnel_radiation_training.sql", "utf8");
const api = fs.readFileSync("app/api/staff/personnel/radiation-training/route.ts", "utf8");
const page = fs.readFileSync("app/staff/personnel/radiation-training/page.tsx", "utf8");
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

function insertTraining(db, {
  id,
  organizationId,
  personnelId,
  trainingDate = "2026-08-21",
  trainingKind = "radiation_safety",
  resultCode = "completed",
  courseTitle = "Radiation safety",
  supersedesId = null,
}) {
  db.prepare(`
    INSERT INTO personnel_radiation_training_records
      (id, organization_id, personnel_id, training_date, training_kind,
       result_code, course_title, supersedes_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test@example.test')
  `).run(id, organizationId, personnelId, trainingDate, trainingKind, resultCode, courseTitle, supersedesId);
}

test("radiation training migration enforces tenant and personnel scope", () => {
  const db = createDatabase();
  insertTraining(db, { id:"t1", organizationId:1, personnelId:"personnel-1" });

  assert.throws(
    () => insertTraining(db, { id:"cross-personnel", organizationId:1, personnelId:"personnel-2" }),
    /personnel_radiation_training_personnel_scope/,
  );

  insertTraining(db, { id:"org2-t1", organizationId:2, personnelId:"personnel-2" });
  assert.throws(
    () => insertTraining(db, {
      id:"cross-supersedes",
      organizationId:1,
      personnelId:"personnel-1",
      supersedesId:"org2-t1",
    }),
    /personnel_radiation_training_supersedes_scope/,
  );

  assert.throws(
    () => insertTraining(db, {
      id:"wrong-person-supersedes",
      organizationId:1,
      personnelId:"personnel-3",
      supersedesId:"t1",
    }),
    /personnel_radiation_training_supersedes_scope/,
  );
});

test("radiation training history is append-only and corrections are single-successor", () => {
  const db = createDatabase();
  insertTraining(db, { id:"t1", organizationId:1, personnelId:"personnel-1" });
  insertTraining(db, {
    id:"t2",
    organizationId:1,
    personnelId:"personnel-1",
    resultCode:"passed",
    supersedesId:"t1",
  });

  assert.throws(
    () => insertTraining(db, {
      id:"t3",
      organizationId:1,
      personnelId:"personnel-1",
      resultCode:"failed",
      supersedesId:"t1",
    }),
    /UNIQUE constraint failed: personnel_radiation_training_records\.supersedes_id/,
  );
  assert.throws(
    () => db.prepare("UPDATE personnel_radiation_training_records SET course_title = 'changed' WHERE id = 't1'").run(),
    /personnel_radiation_training_append_only/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM personnel_radiation_training_records WHERE id = 't1'").run(),
    /personnel_radiation_training_append_only/,
  );
});

test("radiation training API is manager-only, audited and independent of operational access", () => {
  assert.match(api, /requireSelfServiceOrgContext/);
  assert.match(api, /role === "admin" \|\| role === "department_head"/);
  assert.match(api, /personnel_radiation_training_viewed/);
  assert.match(api, /personnel_radiation_training_recorded/);
  assert.match(api, /organization_id = \?/);
  assert.match(api, /personnel_id = \?/);
  assert.match(api, /supersedes_id/);
  assert.doesNotMatch(api, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(api, /imaging_studies|pacs_settings|bookings|canManageImaging/);
});

test("radiation training UI remains separate from clearance, VLK, dosimetry and operational gate", () => {
  assert.match(page, /personnelId/);
  assert.match(page, /Радіаційна безпека · навчання/);
  assert.match(page, /Append-only/);
  assert.match(page, /supersedesId/);
  assert.match(page, /trainingHours/);
  assert.match(page, /certificateNumber/);
  assert.match(page, /Допуск до ДІВ ведеться окремо/);
  assert.match(page, /дозиметр/i);
  assert.match(page, /operational gate/i);
  assert.doesNotMatch(page, /ВЛК/);
  assert.match(directories, /Радіаційна безпека/);
  assert.match(directories, /\/staff\/personnel\/radiation-training/);
});
