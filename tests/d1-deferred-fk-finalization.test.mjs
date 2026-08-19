import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("remote D1 runner explicitly finalizes deferred foreign keys before migration tracking", async () => {
  const script = await read("scripts/apply-d1-migrations-remote.sh");
  const prepareSql = script.indexOf("node scripts/prepare-d1-migration-remote.mjs");
  const detectDeferred = script.indexOf("PRAGMA[[:space:]]+defer_foreign_keys");
  const finalizeDeferred = script.indexOf("PRAGMA defer_foreign_keys = OFF;");
  const tracking = script.indexOf("INSERT INTO d1_migrations (name) VALUES ('%s');");
  const executeFile = script.indexOf('--file "${IMPORT_FILE}"');

  assert.notEqual(prepareSql, -1);
  assert.notEqual(detectDeferred, -1);
  assert.notEqual(finalizeDeferred, -1);
  assert.notEqual(tracking, -1);
  assert.notEqual(executeFile, -1);
  assert.ok(prepareSql < detectDeferred);
  assert.ok(detectDeferred < finalizeDeferred);
  assert.ok(finalizeDeferred < tracking);
  assert.ok(tracking < executeFile);
});

test("explicit deferred-FK finalization permits a referenced parent-table rebuild only after references are valid", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
      CREATE TABLE organizations (id INTEGER PRIMARY KEY);
      INSERT INTO organizations (id) VALUES (1);
      CREATE TABLE business_documents (
        id INTEGER PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        document_type TEXT NOT NULL CHECK (document_type IN ('service_delivery','study_performance')),
        reversed_document_id INTEGER,
        FOREIGN KEY (organization_id) REFERENCES organizations(id),
        FOREIGN KEY (reversed_document_id) REFERENCES business_documents(id)
      );
      CREATE UNIQUE INDEX business_documents_id_org_idx
        ON business_documents(id, organization_id);
      CREATE TABLE child_register (
        id INTEGER PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        FOREIGN KEY (document_id, organization_id)
          REFERENCES business_documents(id, organization_id)
      );
      INSERT INTO business_documents
        (id, organization_id, document_type)
        VALUES (1, 1, 'service_delivery');
      INSERT INTO child_register
        (id, organization_id, document_id)
        VALUES (1, 1, 1);
    `);

    db.exec("BEGIN;");
    db.exec("PRAGMA defer_foreign_keys = ON;");
    db.exec(`
      CREATE TABLE __new_business_documents (
        id INTEGER PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        document_type TEXT NOT NULL CHECK (
          document_type IN ('service_delivery','study_performance','study_correction')
        ),
        reversed_document_id INTEGER,
        FOREIGN KEY (organization_id) REFERENCES organizations(id),
        FOREIGN KEY (reversed_document_id) REFERENCES business_documents(id)
      );
      INSERT INTO __new_business_documents
        SELECT * FROM business_documents;
      DROP TABLE business_documents;
      ALTER TABLE __new_business_documents RENAME TO business_documents;
      CREATE UNIQUE INDEX business_documents_id_org_idx
        ON business_documents(id, organization_id);
    `);

    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("PRAGMA defer_foreign_keys = OFF;");
    db.exec("COMMIT;");

    assert.equal(db.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(
      { ...db.prepare("SELECT organization_id, document_id FROM child_register").get() },
      { organization_id: 1, document_id: 1 },
    );
    assert.match(
      db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='business_documents'").get().sql,
      /study_correction/,
    );
  } finally {
    db.close();
  }
});
