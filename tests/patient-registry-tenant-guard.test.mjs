import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("patient registry route scopes audit and upsert by organization", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  assert.match(route, /organizationId: orgId/);
  assert.match(route, /WHERE patient_profiles\.organization_id = excluded\.organization_id/);
});