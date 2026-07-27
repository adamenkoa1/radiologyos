import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("catalog contains 38 unique services across all equipment types", async () => {
  const source = await readFile(new URL("../lib/catalog.ts", import.meta.url), "utf8");
  const codes = [...source.matchAll(/\{\s*code:"(\d+)"/g)].map(match => match[1]);
  assert.equal(codes.length, 38);
  assert.equal(new Set(codes).size, 38);
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

test("staff reports require authorization and export only aggregate daily CSV", async () => {
  const route = await readFile(new URL("../app/api/staff/reports/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireStaff\(request, db\)/);
  assert.match(route, /format"\) === "csv"/);
  assert.match(route, /Дані згруповано|byDay|Оплачено, грн/);
  assert.doesNotMatch(route, /SELECT[^`]*(?:name|phone)/i);
});
