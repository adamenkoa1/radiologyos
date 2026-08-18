import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DRIZZLE_DIR = new URL("../drizzle/", import.meta.url);
const SCHEMA_URL = new URL("../db/schema.ts", import.meta.url);

function migrationNumber(file) {
  const match = /^(\d{4})_[A-Za-z0-9_.-]+\.sql$/.exec(file);
  return match ? Number(match[1]) : null;
}

async function migrationInventory() {
  const files = (await readdir(fileURLToPath(DRIZZLE_DIR)))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const numbered = files.map((file) => ({ file, number: migrationNumber(file) }));
  for (const item of numbered) {
    assert.notEqual(item.number, null, `Migration filename must start with a four-digit prefix: ${item.file}`);
  }
  const seen = new Map();
  for (const item of numbered) {
    const prior = seen.get(item.number);
    assert.equal(prior, undefined, `Duplicate migration prefix ${String(item.number).padStart(4, "0")}: ${prior} and ${item.file}`);
    seen.set(item.number, item.file);
  }
  return numbered;
}

async function applyFiles(db, items) {
  for (const { file } of items) {
    const sql = await readFile(new URL(file, DRIZZLE_DIR), "utf8");
    try {
      if (file === "0093_study_correction_registrar.sql") {
        db.exec("BEGIN;");
        try {
          db.exec(sql);
          db.exec("COMMIT;");
        } catch (migrationError) {
          try { db.exec("ROLLBACK;"); } catch {}
          throw migrationError;
        }
      } else {
        db.exec(sql);
      }
    } catch (error) {
      throw new Error(`Migration ${file} failed during upgrade gate: ${error.message}`);
    }
  }
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function indexNames(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all().map((row) => row.name);
}

function indexColumns(db, index) {
  return db.prepare(`PRAGMA index_info(${index})`).all().map((row) => row.name);
}

function plainRow(row) {
  return row == null ? row : Object.fromEntries(Object.entries(row));
}

test("Drizzle PACS schema matches tenant migration contract", async () => {
  const schema = await readFile(SCHEMA_URL, "utf8");
  const pacsBlock = schema.match(/export const pacsSettings = sqliteTable\("pacs_settings", \{[\s\S]*?\n\}\s*,\s*table => \[[\s\S]*?\]\);/);
  assert.ok(pacsBlock, "pacsSettings must declare a table-level tenant index");
  assert.match(
    pacsBlock[0],
    /organizationId:\s*integer\("organization_id"\)\.notNull\(\)\.default\(1\)/,
    "pacsSettings.organizationId must match migration 0031 nullability/default",
  );
  assert.match(
    pacsBlock[0],
    /uniqueIndex\("pacs_settings_organization_idx"\)\.on\(table\.organizationId\)/,
    "pacsSettings must keep the one-row-per-organization uniqueness contract",
  );
});

test("production baseline through 0029 upgrades through 0033 without losing existing data", async () => {
  const inventory = await migrationInventory();
  const baseline = inventory.filter((item) => item.number <= 29);
  const release = inventory.filter((item) => item.number >= 30 && item.number <= 33);
  assert.deepEqual(release.map((item) => item.number), [30, 31, 32, 33]);

  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    await applyFiles(db, baseline);

    db.prepare(
      `UPDATE pacs_settings
       SET dicomweb_base_url = ?, viewer_base_url = ?, ae_title = ?, enabled = 1,
           notes = ?, updated_by = ?
       WHERE id = 1`,
    ).run(
      "https://legacy-pacs.example.test/dicom-web",
      "https://legacy-viewer.example.test/viewer",
      "LEGACYPACS",
      "preserve this configuration",
      "legacy-admin@example.test",
    );

    const bookingResult = db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, equipment_id, desired_date, desired_time, status, comment)
       VALUES (1, 'UPGRADE-001', 'Пацієнт До Міграції', '+380501112233', '380501112233',
         '1985-06-07', 'КТ органів грудної клітки', '408', 'ct',
         '2026-08-20', '10:00', 'confirmed', 'legacy booking must survive')`,
    ).run();
    const bookingId = Number(bookingResult.lastInsertRowid);

    const imagingColumns = tableColumns(db, "imaging_studies");
    if (imagingColumns.includes("organization_id")) {
      db.prepare(
        `INSERT INTO imaging_studies
          (organization_id, booking_id, accession_number, study_instance_uid, modality,
           study_status, source, updated_by)
         VALUES (1, ?, 'LEGACY-ACC-001', '1.2.840.10008.5.1.4.1', 'CT',
           'available', 'manual', 'legacy-radiographer@example.test')`,
      ).run(bookingId);
    } else {
      db.prepare(
        `INSERT INTO imaging_studies
          (booking_id, accession_number, study_instance_uid, modality,
           study_status, source, updated_by)
         VALUES (?, 'LEGACY-ACC-001', '1.2.840.10008.5.1.4.1', 'CT',
           'available', 'manual', 'legacy-radiographer@example.test')`,
      ).run(bookingId);
    }

    db.prepare(
      `INSERT INTO security_audit_log
        (actor_email, action, resource, target_id, details_json)
       VALUES ('legacy-admin@example.test', 'legacy_event', 'system', 'legacy-1', '{"preserve":true}')`,
    ).run();
    assert.equal(tableColumns(db, "security_audit_log").includes("organization_id"), false);

    const legacyPacs = plainRow(db.prepare(
      `SELECT dicomweb_base_url AS dicomwebBaseUrl, viewer_base_url AS viewerBaseUrl,
        ae_title AS aeTitle, enabled, notes, updated_by AS updatedBy
       FROM pacs_settings WHERE id = 1`,
    ).get());
    const legacyBooking = plainRow(db.prepare(
      "SELECT code, name, phone, service, status, comment FROM bookings WHERE id = ?",
    ).get(bookingId));
    const legacyImaging = plainRow(db.prepare(
      `SELECT accession_number AS accessionNumber, study_instance_uid AS studyInstanceUid,
        modality, study_status AS studyStatus, source, updated_by AS updatedBy
       FROM imaging_studies WHERE booking_id = ?`,
    ).get(bookingId));

    await applyFiles(db, release);

    const upgradedPacs = plainRow(db.prepare(
      `SELECT organization_id AS organizationId, dicomweb_base_url AS dicomwebBaseUrl,
        viewer_base_url AS viewerBaseUrl, ae_title AS aeTitle, enabled, notes,
        updated_by AS updatedBy FROM pacs_settings WHERE id = 1`,
    ).get());
    assert.equal(upgradedPacs.organizationId, 1);
    assert.deepEqual(
      Object.fromEntries(Object.entries(upgradedPacs).filter(([key]) => key !== "organizationId")),
      legacyPacs,
    );

    assert.deepEqual(
      plainRow(db.prepare("SELECT code, name, phone, service, status, comment FROM bookings WHERE id = ?").get(bookingId)),
      legacyBooking,
    );
    assert.deepEqual(
      plainRow(db.prepare(
        `SELECT accession_number AS accessionNumber, study_instance_uid AS studyInstanceUid,
          modality, study_status AS studyStatus, source, updated_by AS updatedBy
         FROM imaging_studies WHERE booking_id = ?`,
      ).get(bookingId)),
      legacyImaging,
    );

    assert.deepEqual(tableColumns(db, "analytics_events"), [
      "id", "organization_id", "event_name", "journey_id", "service_code",
      "patient_category", "page_key", "source", "occurred_at",
    ]);
    assert.ok(indexNames(db, "analytics_events").includes("analytics_events_org_event_time_idx"));

    assert.ok(tableColumns(db, "pacs_settings").includes("organization_id"));
    assert.ok(indexNames(db, "pacs_settings").includes("pacs_settings_organization_idx"));

    assert.deepEqual(tableColumns(db, "mwl_bridge_tokens"), [
      "organization_id", "token_hash", "active", "created_by", "created_at", "rotated_at", "last_used_at",
    ]);
    assert.deepEqual(tableColumns(db, "mwl_patient_ids"), [
      "organization_id", "identity_key", "patient_id", "created_at",
    ]);
    assert.ok(indexNames(db, "mwl_bridge_tokens").includes("mwl_bridge_tokens_hash_idx"));
    assert.ok(indexNames(db, "mwl_patient_ids").includes("mwl_patient_ids_org_patient_idx"));

    assert.ok(tableColumns(db, "security_audit_log").includes("organization_id"));
    const legacyAudit = plainRow(db.prepare(
      `SELECT organization_id AS organizationId, actor_email AS actorEmail, action, target_id AS targetId
       FROM security_audit_log WHERE action = 'legacy_event'`,
    ).get());
    assert.deepEqual(legacyAudit, {
      organizationId: 1,
      actorEmail: "legacy-admin@example.test",
      action: "legacy_event",
      targetId: "legacy-1",
    });
    assert.ok(indexNames(db, "security_audit_log").includes("security_audit_created_idx"));
    assert.deepEqual(indexColumns(db, "security_audit_created_idx"), ["organization_id", "created_at", "actor_email"]);

    db.prepare(
      `INSERT INTO security_audit_log
        (organization_id, actor_email, action, resource, target_id, details_json)
       VALUES (2, 'org2-admin@example.test', 'org2_event', 'report', 'org2-1', '{}')`,
    ).run();
    const org2Audit = plainRow(db.prepare(
      `SELECT organization_id AS organizationId, actor_email AS actorEmail
       FROM security_audit_log WHERE action = 'org2_event'`,
    ).get());
    assert.deepEqual(org2Audit, { organizationId: 2, actorEmail: "org2-admin@example.test" });
  } finally {
    db.close();
  }
});
