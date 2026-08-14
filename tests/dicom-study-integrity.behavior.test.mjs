import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function addOrganization(db, id, slug) {
  await db.prepare("INSERT INTO organizations (id,slug,name,active) VALUES (?,?,?,1)")
    .bind(id, slug, `Organization ${id}`).run();
}

async function addBooking(db, organizationId, code, time) {
  const result = await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,service,desired_date,desired_time)
    VALUES (?,?,'Patient','+380000000001','CT','2026-08-14',?)`)
    .bind(organizationId, code, time).run();
  return Number(result.meta.last_row_id);
}

async function addStudy(db, organizationId, bookingId, uid) {
  return db.prepare(`INSERT INTO imaging_studies
    (organization_id,booking_id,accession_number,study_instance_uid,modality,study_status,updated_by)
    VALUES (?,?,?,?,'CT','available','tester')`)
    .bind(organizationId, bookingId, `ACC-${bookingId}`, uid).run();
}

test("D1 rejects cross-tenant imaging ownership and duplicate StudyInstanceUID links", async () => {
  await withD1(async (db) => {
    await addOrganization(db, 2, "dicom-other");
    const booking1 = await addBooking(db, 1, "DICOM-1", "10:00");
    const booking1b = await addBooking(db, 1, "DICOM-1B", "11:00");
    const booking2 = await addBooking(db, 2, "DICOM-2", "12:00");
    const uid = "1.2.840.113619.2.55.3.604688123.1";

    await addStudy(db, 1, booking1, uid);

    await assert.rejects(
      addStudy(db, 1, booking2, "1.2.840.113619.2.55.3.604688123.2"),
      /tenant mismatch/i,
    );
    await assert.rejects(
      db.prepare("UPDATE imaging_studies SET organization_id=2 WHERE booking_id=?").bind(booking1).run(),
      /tenant mismatch/i,
    );

    await assert.rejects(
      addStudy(db, 1, booking1b, uid),
      /StudyInstanceUID already linked/i,
    );

    await addStudy(db, 1, booking1b, "1.2.840.113619.2.55.3.604688123.3");
    await assert.rejects(
      db.prepare("UPDATE imaging_studies SET study_instance_uid=? WHERE booking_id=? AND organization_id=1")
        .bind(uid, booking1b).run(),
      /StudyInstanceUID already linked/i,
    );

    // Tenant isolation is intentional: two independent organizations may point
    // at separate PACS namespaces that happen to use the same UID value.
    await addStudy(db, 2, booking2, uid);
    const rows = await db.prepare(
      "SELECT organization_id AS organizationId, booking_id AS bookingId FROM imaging_studies WHERE study_instance_uid=? ORDER BY organization_id"
    ).bind(uid).all();
    assert.deepEqual(rows.results.map((row) => [row.organizationId, row.bookingId]), [
      [1, booking1],
      [2, booking2],
    ]);
  });
});

test("PACS settings cannot reference a nonexistent organization", async () => {
  await withD1(async (db) => {
    await assert.rejects(
      db.prepare(`INSERT INTO pacs_settings
        (organization_id,dicomweb_base_url,viewer_base_url,ae_title,enabled,updated_by)
        VALUES (999,'https://pacs.example.com/dicom-web','https://viewer.example.com','RAD',1,'tester')`).run(),
      /organization does not exist/i,
    );
  });
});

test("DICOM integrity migration and Drizzle schema contain tenant and UID guards", async () => {
  const migration = await read("drizzle/0045_dicom_study_integrity.sql");
  assert.match(migration, /imaging_studies_booking_tenant_insert/);
  assert.match(migration, /imaging_studies_booking_tenant_update/);
  assert.match(migration, /imaging_studies_uid_unique_insert/);
  assert.match(migration, /imaging_studies_uid_unique_update/);
  assert.match(migration, /imaging_studies_org_uid_idx/);
  assert.match(migration, /pacs_settings_org_insert/);

  const schema = await read("db/schema.ts");
  assert.match(schema, /imaging_studies_org_idx/);
  assert.match(schema, /imaging_studies_org_uid_idx/);
  assert.match(schema, /study_instance_uid != ''/);
});
