import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const preparer = fileURLToPath(new URL("../scripts/prepare-d1-migration-remote.mjs", import.meta.url));
const migrationName = "0093_study_correction_registrar.sql";

const synthetic0093 = `
PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;
CREATE TABLE \`__new_business_documents\` (
  \`id\` integer PRIMARY KEY NOT NULL,
  \`organization_id\` integer NOT NULL,
  \`document_type\` text NOT NULL CHECK (\`document_type\` IN ('patient_order','study_correction')),
  \`state\` text NOT NULL,
  \`basis_document_id\` integer,
  \`reversed_document_id\` integer,
  FOREIGN KEY (\`reversed_document_id\`) REFERENCES \`business_documents\`(\`id\`)
);
INSERT INTO \`__new_business_documents\`
  (\`id\`,\`organization_id\`,\`document_type\`,\`state\`,\`basis_document_id\`,\`reversed_document_id\`)
SELECT \`id\`,\`organization_id\`,\`document_type\`,\`state\`,\`basis_document_id\`,\`reversed_document_id\`
FROM \`business_documents\`;
DROP TABLE \`business_documents\`;
ALTER TABLE \`__new_business_documents\` RENAME TO \`business_documents\`;
PRAGMA legacy_alter_table = OFF;
CREATE UNIQUE INDEX \`business_documents_id_org_idx\`
  ON \`business_documents\` (\`id\`,\`organization_id\`);
`;

const emptyDependencyTables = [
  "cash_movements",
  "equipment_load_movements",
  "finance_document_details",
  "inventory_document_lines",
  "patient_settlement_movements",
  "printed_form_snapshots",
  "result_delivery_details",
  "revenue_movements",
  "service_correction_details",
  "service_correction_movements",
  "service_delivery_details",
  "services_delivered_movements",
  "staff_output_movements",
  "supplier_payable_movements",
  "supplier_payment_allocations",
];

function prepareSyntheticMigration() {
  const dir = mkdtempSync(join(tmpdir(), "radiologyos-d1-0093-"));
  const source = join(dir, migrationName);
  const output = join(dir, "prepared.sql");
  writeFileSync(source, synthetic0093);
  const result = spawnSync(process.execPath, [preparer, source, output, migrationName], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sql = readFileSync(output, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return sql;
}

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE bookings (
      id integer PRIMARY KEY,
      organization_id integer NOT NULL,
      patient_id text NOT NULL,
      patient_category text NOT NULL,
      service_code text NOT NULL,
      service text NOT NULL,
      equipment_id text NOT NULL,
      duration_minutes integer NOT NULL,
      payment_amount integer NOT NULL
    );
    CREATE TABLE business_documents (
      id integer PRIMARY KEY NOT NULL,
      organization_id integer NOT NULL,
      document_type text NOT NULL CHECK (document_type IN ('patient_order')),
      state text NOT NULL,
      basis_document_id integer,
      reversed_document_id integer,
      FOREIGN KEY (reversed_document_id) REFERENCES business_documents(id)
    );
    CREATE UNIQUE INDEX business_documents_id_org_idx
      ON business_documents(id, organization_id);
    CREATE TABLE patient_order_details (
      organization_id integer NOT NULL,
      document_id integer PRIMARY KEY NOT NULL,
      booking_id integer NOT NULL,
      patient_id text DEFAULT '' NOT NULL,
      patient_category text DEFAULT '' NOT NULL,
      service_code text NOT NULL,
      service_title text NOT NULL,
      equipment_id text NOT NULL,
      duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
      price_amount integer DEFAULT 0 NOT NULL CHECK (price_amount >= 0),
      charge_amount integer DEFAULT 0 NOT NULL CHECK (charge_amount >= 0),
      currency text DEFAULT 'UAH' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (document_id, organization_id) REFERENCES business_documents(id, organization_id),
      FOREIGN KEY (booking_id) REFERENCES bookings(id)
    );
    CREATE UNIQUE INDEX patient_order_booking_unique
      ON patient_order_details(organization_id, booking_id);
  `);
  for (const table of emptyDependencyTables) {
    db.exec(`CREATE TABLE ${table} (id integer PRIMARY KEY);`);
  }
  db.exec(`
    INSERT INTO bookings
      (id,organization_id,patient_id,patient_category,service_code,service,equipment_id,duration_minutes,payment_amount)
    VALUES (1,1,'patient-1','civilian','CT','CT chest','ct-1',20,4700);
    INSERT INTO business_documents
      (id,organization_id,document_type,state,basis_document_id,reversed_document_id)
    VALUES (1,1,'patient_order','posted',NULL,NULL);
    INSERT INTO patient_order_details
      (organization_id,document_id,booking_id,patient_id,patient_category,service_code,service_title,
       equipment_id,duration_minutes,price_amount,charge_amount,currency,created_at)
    VALUES (1,1,1,'patient-1','civilian','CT','CT chest','ct-1',20,4700,4700,'UAH','2026-08-19 10:00:00');
    CREATE TRIGGER patient_order_details_integrity_insert
    BEFORE INSERT ON patient_order_details
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM business_documents d
        WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
          AND d.document_type='patient_order' AND d.state='draft' AND d.basis_document_id IS NULL
      ) THEN RAISE(ABORT,'patient_order_document_invalid') END;
    END;
    CREATE TRIGGER patient_order_details_no_delete_posted
    BEFORE DELETE ON patient_order_details
    WHEN NOT EXISTS (
      SELECT 1 FROM business_documents d
      WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
    )
    BEGIN SELECT RAISE(ABORT,'patient_order_not_draft'); END;
  `);
  return db;
}

function executeAsSingleTransaction(db, sql) {
  db.exec("BEGIN;");
  try {
    db.exec(sql);
    db.exec("PRAGMA defer_foreign_keys = OFF;");
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {}
    throw error;
  }
}

test("0093 D1 bridge preserves a posted Patient Order row while rebuilding its referenced parent", () => {
  const prepared = prepareSyntheticMigration();
  assert.match(prepared, /D1 0093 live-FK bridge: begin/);
  assert.match(prepared, /__d1_0093_patient_order_backup/);
  assert.match(prepared, /EXCEPT SELECT/);

  const db = createDatabase();
  try {
    assert.throws(
      () => db.exec("DELETE FROM patient_order_details WHERE document_id=1;"),
      /patient_order_not_draft/,
    );

    executeAsSingleTransaction(db, prepared);

    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(
      { ...db.prepare(`
        SELECT organization_id,document_id,booking_id,patient_id,patient_category,service_code,
               service_title,equipment_id,duration_minutes,price_amount,charge_amount,currency,created_at
        FROM patient_order_details
      `).get() },
      {
        organization_id: 1,
        document_id: 1,
        booking_id: 1,
        patient_id: "patient-1",
        patient_category: "civilian",
        service_code: "CT",
        service_title: "CT chest",
        equipment_id: "ct-1",
        duration_minutes: 20,
        price_amount: 4700,
        charge_amount: 4700,
        currency: "UAH",
        created_at: "2026-08-19 10:00:00",
      },
    );
    assert.match(
      db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='business_documents'").get().sql,
      /study_correction/,
    );
    assert.throws(
      () => db.exec("DELETE FROM patient_order_details WHERE document_id=1;"),
      /patient_order_not_draft/,
    );
  } finally {
    db.close();
  }
});

test("0093 D1 bridge fails before mutation when another business-document dependency has rows", () => {
  const prepared = prepareSyntheticMigration();
  const db = createDatabase();
  try {
    db.exec("INSERT INTO cash_movements(id) VALUES (1);");
    assert.throws(() => executeAsSingleTransaction(db, prepared), /CHECK constraint failed/);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM patient_order_details").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM business_documents").get().count, 1);
    assert.match(
      db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='business_documents'").get().sql,
      /patient_order/,
    );
    assert.doesNotMatch(
      db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='business_documents'").get().sql,
      /study_correction/,
    );
  } finally {
    db.close();
  }
});

test("non-0093 migrations are copied byte-for-byte by the remote preparer", () => {
  const dir = mkdtempSync(join(tmpdir(), "radiologyos-d1-copy-"));
  try {
    const source = join(dir, "0094_example.sql");
    const output = join(dir, "prepared.sql");
    const body = "CREATE TABLE example (id integer PRIMARY KEY);\n";
    writeFileSync(source, body);
    const result = spawnSync(process.execPath, [preparer, source, output, "0094_example.sql"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(readFileSync(output, "utf8"), body);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
