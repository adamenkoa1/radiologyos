import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("patient registry route scopes audit and upsert by organization", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  const migration = await read("drizzle/0035_patient_composite_identity.sql");
  assert.match(route, /organizationId: orgId/);
  assert.match(route, /ON CONFLICT\(organization_id, phone_normalized\) DO UPDATE SET/);
  assert.match(migration, /PRIMARY KEY \(`organization_id`, `phone_normalized`\)/);
});