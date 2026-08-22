import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("catalog mirrors the 27 official services of Наказ в/ч А3120 №265, Додаток 2", async () => {
  const source = await readFile(new URL("../lib/catalog.ts", import.meta.url), "utf8");
  const codes = [...source.matchAll(/\{\s*code:"(\d+)"/g)].map(match => match[1]);
  // Exactly the codes approved by the order: 101; 201–205; 301–302; 401–412; 501–504; 601–603.
  const official = [
    "101", "201", "202", "203", "204", "205", "301", "302",
    "401", "402", "403", "404", "405", "406", "407", "408", "409", "410", "411", "412",
    "501", "502", "503", "504", "601", "602", "603",
  ];
  assert.equal(codes.length, official.length);
  assert.deepEqual(codes, official);
  assert.equal(new Set(codes).size, official.length);
  for (const equipmentId of ["ct", "xray", "fluoro"]) {
    assert.match(source, new RegExp(`equipmentId:"${equipmentId}"`));
  }
});

test("API routes never create schema during ordinary requests", async () => {
  const apiRoot = new URL("../app/api/", import.meta.url);
  async function collect(directory) {
    const entries = await readdir(directory, { withFileTypes:true });
    const files = [];
    for (const entry of entries) {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) files.push(...await collect(url));
      else if (entry.name.endsWith(".ts")) files.push(url);
    }
    return files;
  }
  const sources = await Promise.all((await collect(apiRoot)).map(file => readFile(file, "utf8")));
  assert.doesNotMatch(sources.join("\n"), /CREATE\s+TABLE/i);
  assert.doesNotMatch(sources.join("\n"), /ALTER\s+TABLE/i);
});

test("domain migration adds equipment scheduling and staff authorization", async () => {
  const migration = await readFile(new URL("../drizzle/0001_domain_model.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `staff_members`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `equipment_blocks`/);
  assert.match(migration, /`phone_normalized`/);
  assert.match(migration, /DROP INDEX IF EXISTS `active_booking_slot`/);
});

test("operations migration adds protocol, finance and reporting fields", async () => {
  const migration = await readFile(new URL("../drizzle/0002_operations_reporting.sql", import.meta.url), "utf8");
  assert.match(migration, /`protocol_status`/);
  assert.match(migration, /`payment_status`/);
  assert.match(migration, /`nszu_status`/);
  assert.match(migration, /CREATE INDEX `bookings_report_date_idx`/);
});

test("execution migration adds performers, actual results and export audit", async () => {
  const migration = await readFile(new URL("../drizzle/0003_execution_report_builder.sql", import.meta.url), "utf8");
  for (const field of [
    "assigned_radiologist_email", "assigned_radiographer_email", "performed_at",
    "anatomical_regions_count", "protocol_ready_at", "protocol_issued_at",
    "paid_amount", "medlink_reference",
  ]) assert.match(migration, new RegExp(`\\\`${field}\\\``));
  assert.match(migration, /CREATE TABLE `report_exports`/);
  assert.match(migration, /contains_personal_data/);
});

test("external reference migration replaces the vendor-specific field", async () => {
  const migration = await readFile(new URL("../drizzle/0004_generic_external_reference.sql", import.meta.url), "utf8");
  assert.match(migration, /RENAME COLUMN `medlink_reference` TO `external_reference`/);
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /externalReference: text\("external_reference"\)/);
  assert.doesNotMatch(schema, /medlink/i);
});

test("report builder provides five protected Excel templates without patient identity", async () => {
  const route = await readFile(new URL("../app/api/staff/reports/route.ts", import.meta.url), "utf8");
  const exportRoute = await readFile(new URL("../app/api/staff/reports/export/route.ts", import.meta.url), "utf8");
  const reporting = await readFile(new URL("../lib/reporting.ts", import.meta.url), "utf8");
  const reportingServer = await readFile(new URL("../lib/reporting-server.ts", import.meta.url), "utf8");
  assert.match(route, /requireOrgContext\(request,\s*db\)/);
  assert.match(exportRoute, /requireOrgContext\(request,\s*db\)/);
  assert.match(exportRoute, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(exportRoute, /INSERT INTO report_exports/);
  for (const template of ["studies", "protocols", "staff", "equipment", "finance"]) {
    assert.match(reporting, new RegExp(`\\b${template}: \\\{`));
  }
  assert.doesNotMatch(reportingServer, /\bb\.name\b|\bb\.phone\b/i);
  assert.doesNotMatch(exportRoute, /\bname\b|\bphone\b/i);
});
