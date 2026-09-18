import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("private calendar token resolves a tenant and scopes booking rows", async () => {
  const route = await read("app/api/calendar/route.ts");
  assert.match(route, /calendar_token_hash:org:/);
  assert.match(route, /organizationId = Number\(scoped\[1\]\)/);
  assert.match(route, /WHERE organization_id = \?/);
  assert.match(route, /\.bind\(organizationId\)\.all<CalendarBooking>/);
});

test("calendar token rotation derives the tenant from staff membership", async () => {
  const route = await read("app/api/staff/settings/calendar/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /tokenKey\(ctx\.organizationId\)/);
  assert.match(route, /ctx\.organizationId === 1/);
  assert.match(route, /`\$\{ctx\.organizationId\}\.\$\{token\}`/);
});
