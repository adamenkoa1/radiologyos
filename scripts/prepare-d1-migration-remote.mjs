import { readFile, writeFile } from "node:fs/promises";

const [sourcePath, destinationPath, migrationName] = process.argv.slice(2);

if (!sourcePath || !destinationPath || !migrationName) {
  console.error("Usage: node scripts/prepare-d1-migration-remote.mjs <source> <destination> <migration-name>");
  process.exit(2);
}

const source = await readFile(sourcePath, "utf8");

if (migrationName !== "0093_study_correction_registrar.sql") {
  await writeFile(destinationPath, source);
  process.exit(0);
}

// D1 keeps foreign_keys enabled. Production 0092 contains a live Patient Order detail row
// referencing business_documents, so Drizzle's parent-table DROP/recreate leaves an unresolved
// deferred FK in D1 even though the canonical parent name is restored later in the transaction.
//
// This one-migration bridge is intentionally fail-closed:
//   * only patient_order_details may contain live external references to business_documents;
//   * business_documents may not contain reversal self-links;
//   * Patient Order rows are copied byte-for-byte to a no-FK shadow table;
//   * the live FK rows are absent only inside the same D1 import transaction;
//   * the original migration runs unchanged;
//   * rows are restored and compared in both directions before FK deferral is finalized.
//
// A new/empty database is also safe: the backup can contain zero Patient Order rows.

const requiredMarkers = [
  "PRAGMA defer_foreign_keys = ON;",
  "CREATE TABLE `__new_business_documents`",
  "DROP TABLE `business_documents`;",
  "ALTER TABLE `__new_business_documents` RENAME TO `business_documents`;",
];
for (const marker of requiredMarkers) {
  const first = source.indexOf(marker);
  if (first === -1 || source.indexOf(marker, first + marker.length) !== -1) {
    throw new Error(`0093 D1 bridge source assertion failed for marker: ${marker}`);
  }
}

const columns = [
  "organization_id",
  "document_id",
  "booking_id",
  "patient_id",
  "patient_category",
  "service_code",
  "service_title",
  "equipment_id",
  "duration_minutes",
  "price_amount",
  "charge_amount",
  "currency",
  "created_at",
];
const columnList = columns.map((column) => `\`${column}\``).join(",");

const emptyExternalReferences = [
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

const prelude = `-- D1 0093 live-FK bridge: begin.\n` +
`CREATE TABLE \`__d1_0093_bridge_guard\` (\`ok\` integer NOT NULL CHECK (\`ok\` = 1));\n` +
`INSERT INTO \`__d1_0093_bridge_guard\` (\`ok\`)\n` +
`SELECT CASE WHEN\n` +
`  NOT EXISTS (SELECT 1 FROM \`business_documents\` WHERE \`reversed_document_id\` IS NOT NULL)\n` +
emptyExternalReferences.map((table) => `  AND NOT EXISTS (SELECT 1 FROM \`${table}\`)`).join("\n") +
`\nTHEN 1 ELSE 0 END;\n` +
`CREATE TABLE \`__d1_0093_patient_order_backup\` AS\n` +
`SELECT ${columnList} FROM \`patient_order_details\`;\n` +
`DROP TRIGGER IF EXISTS \`patient_order_details_integrity_insert\`;\n` +
`DROP TRIGGER IF EXISTS \`patient_order_details_no_delete_posted\`;\n` +
`DELETE FROM \`patient_order_details\`;\n` +
`-- D1 0093 live-FK bridge: original migration follows.\n\n`;

const postlude = `\n\n-- D1 0093 live-FK bridge: restore immutable Patient Order facts.\n` +
`INSERT INTO \`patient_order_details\` (${columnList})\n` +
`SELECT ${columnList} FROM \`__d1_0093_patient_order_backup\`;\n` +
`INSERT INTO \`__d1_0093_bridge_guard\` (\`ok\`)\n` +
`SELECT CASE WHEN\n` +
`  NOT EXISTS (SELECT ${columnList} FROM \`__d1_0093_patient_order_backup\` EXCEPT SELECT ${columnList} FROM \`patient_order_details\`)\n` +
`  AND NOT EXISTS (SELECT ${columnList} FROM \`patient_order_details\` EXCEPT SELECT ${columnList} FROM \`__d1_0093_patient_order_backup\`)\n` +
`THEN 1 ELSE 0 END;\n` +
`CREATE TRIGGER IF NOT EXISTS \`patient_order_details_integrity_insert\`\n` +
`BEFORE INSERT ON \`patient_order_details\`\n` +
`BEGIN\n` +
`  SELECT CASE WHEN NOT EXISTS (\n` +
`    SELECT 1 FROM business_documents d\n` +
`    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id\n` +
`      AND d.document_type='patient_order' AND d.state='draft' AND d.basis_document_id IS NULL\n` +
`  ) THEN RAISE(ABORT,'patient_order_document_invalid') END;\n` +
`  SELECT CASE WHEN NOT EXISTS (\n` +
`    SELECT 1 FROM bookings b\n` +
`    WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id\n` +
`      AND b.patient_id=NEW.patient_id\n` +
`      AND b.patient_category=NEW.patient_category\n` +
`      AND b.service_code=NEW.service_code\n` +
`      AND b.service=NEW.service_title\n` +
`      AND b.equipment_id=NEW.equipment_id\n` +
`      AND b.duration_minutes=NEW.duration_minutes\n` +
`      AND b.payment_amount=NEW.price_amount\n` +
`      AND NEW.charge_amount=CASE WHEN b.patient_category='civilian' THEN b.payment_amount ELSE 0 END\n` +
`  ) THEN RAISE(ABORT,'patient_order_booking_snapshot_mismatch') END;\n` +
`END;\n` +
`CREATE TRIGGER IF NOT EXISTS \`patient_order_details_no_delete_posted\`\n` +
`BEFORE DELETE ON \`patient_order_details\`\n` +
`WHEN NOT EXISTS (\n` +
`  SELECT 1 FROM business_documents d\n` +
`  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'\n` +
`)\n` +
`BEGIN SELECT RAISE(ABORT,'patient_order_not_draft'); END;\n` +
`DROP TABLE \`__d1_0093_patient_order_backup\`;\n` +
`DROP TABLE \`__d1_0093_bridge_guard\`;\n` +
`-- D1 0093 live-FK bridge: end.\n`;

await writeFile(destinationPath, prelude + source + postlude);
