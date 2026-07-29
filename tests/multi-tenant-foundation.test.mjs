import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("tenant migration is additive and backfills the initial radiology organization", async () => {
  const migration = await read("drizzle/0016_multi_tenant_foundation.sql");
  for (const table of [
    "organizations",
    "organization_branches",
    "organization_departments",
    "organization_memberships",
    "organization_settings",
    "organization_service_prices",
    "organization_patient_profiles",
    "organization_pacs_settings",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \\\`${table}\\\``));
  }
  assert.match(migration, /chernihiv-military-hospital-radiology/);
  assert.match(migration, /Чернігівський військовий госпіталь/);
  assert.match(migration, /Відділення променевої діагностики/);
  assert.match(migration, /ALTER TABLE `bookings`\s+ADD `organization_id`/);
  assert.match(migration, /INSERT INTO `organization_memberships`[\s\S]+FROM `staff_members`/);
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE)\b/im);

  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((entry) => entry.tag === "0016_multi_tenant_foundation"));
});

test("staff authorization resolves the organization from a bound membership session", async () => {
  const source = await read("lib/staff-auth.ts");
  assert.match(source, /JOIN organization_memberships om/);
  assert.match(source, /om\.organization_id = s\.organization_id/);
  assert.match(source, /s\.organization_id AS organizationId/);
  assert.match(source, /\(token_hash, email, organization_id, department_id, expires_at\)/);
});

test("even an administrator is constrained by the organization boundary", async () => {
  const source = await read("lib/staff-auth.ts");
  assert.match(source, /WHERE id = \? AND organization_id = \? AND \$\{assignment\}/);
  assert.match(source, /canAccessAllBookings\(member\.role\)[\s\S]*\[bookingId, member\.organizationId\]/);
  assert.doesNotMatch(source, /if \(canAccessAllBookings\(member\.role\)\) return true/);
});

test("public booking writes and conflict checks use a server-selected tenant", async () => {
  const booking = await read("app/api/bookings/route.ts");
  const siteBooking = await read("app/api/site-booking/route.ts");
  const availability = await read("app/api/availability/route.ts");
  for (const source of [booking, siteBooking]) {
    assert.match(source, /publicTenant\(\)/);
    assert.match(source, /organization_id/);
  }
  assert.match(booking, /WHERE organization_id = \?/);
  assert.match(siteBooking, /WHERE organization_id = \? AND code = \?/);
  assert.match(availability, /organization_id = \?/);
});

test("tenant-native settings prevent singleton configuration leaks", async () => {
  const settings = await read("lib/settings.ts");
  const tariffs = await read("lib/tariffs.ts");
  const patients = await read("app/api/staff/patients/route.ts");
  const pacs = await read("app/api/staff/imaging/settings/route.ts");
  assert.match(settings, /organization_settings/);
  assert.match(settings, /organization_id/);
  assert.match(tariffs, /organization_service_prices/);
  assert.match(patients, /organization_patient_profiles/);
  assert.match(pacs, /organization_pacs_settings/);
});

test("sensitive staff repositories carry the signed-in organization into queries", async () => {
  for (const path of [
    "app/api/staff/bookings/route.ts",
    "app/api/staff/patients/route.ts",
    "app/api/staff/protocols/route.ts",
    "app/api/staff/imaging/route.ts",
    "app/api/staff/reports/route.ts",
    "app/api/staff/reports/export/route.ts",
    "app/api/staff/dashboard/route.ts",
  ]) {
    const source = await read(path);
    assert.match(source, /member\.organizationId/, `${path} does not use the authenticated tenant`);
    assert.match(source, /organization_id/, `${path} does not scope SQL by tenant`);
  }
});
