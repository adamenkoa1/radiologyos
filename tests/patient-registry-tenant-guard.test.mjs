import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("patient registry scopes exact identity by organization and never upserts by phone", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  const legacyMigration = await read("drizzle/0035_patient_composite_identity.sql");
  const sharedPhoneMigration = await read("drizzle/0054_patient_shared_phone.sql");

  assert.match(route, /organizationId: orgId/);
  assert.match(route, /patient_id = \?/);
  assert.doesNotMatch(route, /ON CONFLICT\(organization_id, phone_normalized\) DO UPDATE SET/);

  // 0035 records the historical phone-composite model; 0054 deliberately removes
  // current phone uniqueness after immutable patient_id becomes the identity key.
  assert.match(legacyMigration, /PRIMARY KEY \(`organization_id`, `phone_normalized`\)/);
  assert.match(sharedPhoneMigration, /CREATE INDEX IF NOT EXISTS `patient_profiles_org_phone_idx`/);
  assert.doesNotMatch(sharedPhoneMigration, /CREATE UNIQUE INDEX(?: IF NOT EXISTS)? `patient_profiles_org_phone_idx`/);
});
