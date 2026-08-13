import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("equipment registry settings derive tenant from org context", async () => {
  const route = await read("app/api/staff/equipment-registry/route.ts");
  assert.match(route, /requireOrgContext\(request,db\)/);
  assert.match(route, /registryKey\(ctx\.organizationId\)/);
  assert.match(route, /organizationId:ctx\.organizationId/);
  assert.doesNotMatch(route, /organizationId:1/);
  assert.doesNotMatch(route, /requireStaff\(/);
});
