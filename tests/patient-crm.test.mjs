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

  const sharedPhone = await read("drizzle/0054_patient_shared_phone.sql");
  assert.match(sharedPhone, /patient_id.*PRIMARY KEY/s);
  assert.match(sharedPhone, /CREATE INDEX IF NOT EXISTS `patient_profiles_org_phone_idx`/);
  assert.doesNotMatch(sharedPhone, /CREATE UNIQUE INDEX[^\n]*patient_profiles_org_phone_idx/);

  const schema = await read("db/schema.ts");
  assert.match(schema, /export const patientProfiles = sqliteTable\("patient_profiles"/);
  assert.match(schema, /export const patientCommunications = sqliteTable\("patient_communications"/);
  assert.match(schema, /index\("patient_profiles_org_phone_idx"\)/);
  assert.doesNotMatch(schema, /uniqueIndex\("patient_profiles_org_phone_idx"\)/);
});

test("CRM library aggregates exact profiles by patient_id and keeps legacy phone groups separate", async () => {
  const source = await read("lib/patients.ts");
  for (const fn of [
    "buildPatientSummaries", "matchesSegment", "segmentCounts",
    "sanitizeProfile", "sanitizeCommunication",
  ]) assert.match(source, new RegExp(`export function ${fn}`));
  for (const segment of ["repeat", "upcoming", "awaiting_protocol", "outstanding_payment", "do_not_contact"]) {
    assert.match(source, new RegExp(`"${segment}"`));
  }
  assert.match(source, /if \(row\.patientId\)/);
  assert.match(source, /exactGroups\.get\(row\.patientId\)/);
  assert.match(source, /legacyGroups\.get\(row\.phoneNormalized\)/);
  assert.match(source, /for \(const \[patientId, profile\] of profiles\)/);
  assert.doesNotMatch(source, /const key = row\.phoneNormalized/);
});

test("CRM API guards profile writes and uses patient_id as the update key", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /canManageBookings\(member\.role\)/);
  assert.match(route, /canViewPatientRegistry\(member\.role\)/);
  assert.match(route, /logSecurityEvent\(/);
  assert.match(route, /sanitizeProfile\(/);
  assert.match(route, /sanitizeCommunication\(/);
  assert.match(route, /WHERE organization_id = \? AND patient_id = \?/);
  assert.match(route, /INSERT INTO patient_profiles/);
  assert.match(route, /INSERT INTO patient_communications/);
  assert.doesNotMatch(route, /ON CONFLICT\(organization_id, phone_normalized\)/);
  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
});

test("patient registry query is bounded (no unbounded profile scan)", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  assert.match(route, /FROM patient_profiles WHERE organization_id = \? ORDER BY updated_at DESC LIMIT \d+/);
});

test("reminder and telegram send failures are logged, not silently swallowed", async () => {
  const bookings = await read("app/api/staff/bookings/route.ts");
  assert.match(bookings, /console\.error\("reminder_failed"/);
  const site = await read("app/api/site-booking/route.ts");
  assert.match(site, /console\.error\("telegram_notify_failed"/);
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

test("CRM card shows a loading state, exact book action, and context-correct visit links", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /cardLoading/);
  assert.match(page, /Завантаження картки…/);
  assert.match(page, /crmBookBtn/);
  assert.match(page, /patientId:card\.patientId/);
  assert.match(page, /\/staff\/book\?/);
  assert.match(page, /Записати на дослідження/);
  assert.match(page, /\/staff\/appointments\?date=/);
  assert.match(page, /performedAt \|\| \["ready","issued","in_progress"\]/);
  assert.match(page, /<BookingDrawer/);
  assert.match(page, /button type="button" className="crmVisitHead"/);
  assert.match(page, /drawerPatch/);
});

test("booking form pre-fills immutable patient identity and contact snapshots from CRM", async () => {
  const page = await read("app/staff/book/page.tsx");
  for (const p of ["patientId", "name", "phone", "dob", "category"]) {
    assert.match(page, new RegExp(`params\\.get\\("${p}"\\)`), `reads ${p}`);
  }
  assert.match(page, /fetch\(patientId \? "\/api\/staff\/bookings\/exact" : "\/api\/staff\/bookings"/);
  assert.match(page, /\.\.\.\(patientId \? \{ patientId \} : \{\}\)/);
  assert.match(page, /value=\{name\} onChange/);
  assert.match(page, /value=\{phone\} onChange/);
  assert.match(page, /value=\{category\} onChange/);
});
