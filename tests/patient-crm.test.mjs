import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("CRM migration creates profile and communication tables with indexes", async () => {
  const migration = await read("drizzle/0006_patient_crm.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `patient_profiles`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `patient_communications`/);
  for (const column of ["phone_normalized", "display_name", "do_not_contact", "channel", "direction", "summary"]) {
    assert.match(migration, new RegExp(`\\\`${column}\\\``));
  }
  assert.match(migration, /CREATE INDEX IF NOT EXISTS `patient_communications_phone_idx`/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS `bookings_patient_idx`/);

  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((entry) => entry.tag === "0006_patient_crm"));

  const schema = await read("db/schema.ts");
  assert.match(schema, /export const patientProfiles = sqliteTable\("patient_profiles"/);
  assert.match(schema, /export const patientCommunications = sqliteTable\("patient_communications"/);
});

test("CRM library aggregates bookings into patient summaries by phone", async () => {
  const source = await read("lib/patients.ts");
  for (const fn of [
    "buildPatientSummaries", "matchesSegment", "segmentCounts",
    "sanitizeProfile", "sanitizeCommunication",
  ]) assert.match(source, new RegExp(`export function ${fn}`));
  for (const segment of ["repeat", "upcoming", "awaiting_protocol", "outstanding_payment", "do_not_contact"]) {
    assert.match(source, new RegExp(`"${segment}"`));
  }
  // Patients are grouped strictly by normalized phone.
  assert.match(source, /const key = row\.phoneNormalized/);
});

test("CRM API guards profile writes and validates before persisting", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  assert.match(route, /requireStaff\(request, db\)/);
  assert.match(route, /canManageBookings\(member\.role\)/);
  assert.match(route, /canWriteNotes\(member\.role\)/);
  assert.match(route, /sanitizeProfile\(/);
  assert.match(route, /sanitizeCommunication\(/);
  assert.match(route, /INSERT INTO patient_profiles/);
  assert.match(route, /INSERT INTO patient_communications/);
  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
});

async function renderPath(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("CRM page renders inside the staff workspace", async () => {
  const response = await renderPath("/staff/patients");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Картки пацієнтів/);
  assert.match(html, /Оберіть пацієнта зі списку/);
});
