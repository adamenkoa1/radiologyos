import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("schedule is scoped to the active organization", async () => {
  const route = await read("app/api/staff/schedule/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /getOrgSetting\(db, ctx\.organizationId, SCHEDULE_KEY\)/);
  assert.match(route, /m\.organization_id = \?/);
  assert.match(route, /bind\(ctx\.organizationId\)\.all\(\)/);
  assert.match(route, /setOrgSettingCompat\(db, ctx\.organizationId/);
  assert.match(route, /organizationId: ctx\.organizationId/);
  assert.doesNotMatch(route, /organizationId: 1/);
});

test("equipment registry is scoped to the active organization", async () => {
  const route = await read("app/api/staff/equipment-registry/route.ts");
  assert.match(route, /requireOrgContext\(request,db\)/);
  assert.match(route, /getOrgSetting\(db,ctx\.organizationId,EQUIPMENT_REGISTRY_KEY\)/);
  assert.match(route, /setOrgSettingCompat\(db,ctx\.organizationId/);
  assert.match(route, /organizationId:ctx\.organizationId/);
  assert.doesNotMatch(route, /organizationId:1/);
});
