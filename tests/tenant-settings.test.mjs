import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("organization settings migration scopes values by tenant", async () => {
  const sql = await read("drizzle/0035_organization_settings.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `organization_settings`/);
  assert.match(sql, /PRIMARY KEY \(`organization_id`, `key`\)/);
  assert.match(sql, /SELECT 1, `key`, `value` FROM `app_settings`/);
});

test("settings helpers separate organization data from legacy app settings", async () => {
  const src = await read("lib/settings.ts");
  assert.match(src, /getOrgSettings/);
  assert.match(src, /WHERE organization_id = \? AND key = \?/);
  assert.match(src, /ON CONFLICT\(organization_id, key\)/);
  assert.match(src, /if \(organizationId === 1\) await setSetting/);
});

test("staff settings use server tenant context for reads writes and audit", async () => {
  const route = await read("app/api/staff/settings/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /ctx\.role !== "admin"/);
  assert.match(route, /getOrgSettings\(db, ctx\.organizationId/);
  assert.match(route, /setOrgSettingCompat\(db, ctx\.organizationId/);
  assert.match(route, /organizationId: ctx\.organizationId/);
  assert.doesNotMatch(route, /organizationId: 1/);
});
