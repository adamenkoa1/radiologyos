import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("tenant context denies staff identities without an active membership", async () => {
  const tenant = await read("lib/tenant.ts");
  assert.match(tenant, /FROM memberships m/);
  assert.match(tenant, /WHERE m\.member_email = \? AND m\.active = 1/);
  assert.match(tenant, /if \(!row\) return null/);
  assert.doesNotMatch(tenant, /INSERT INTO memberships/);
  assert.doesNotMatch(tenant, /fallback/);
});

test("membership role replaces the global staff role in tenant context", async () => {
  const tenant = await read("lib/tenant.ts");
  assert.match(tenant, /const role = row\.role as StaffRole/);
  assert.match(tenant, /member: \{ email: identity\.email, displayName: identity\.displayName, role \}/);
  assert.match(tenant, /ACTIVE_STAFF_ROLES\.has/);
});

test("staff administration is scoped to the active organization membership", async () => {
  const route = await read("app/api/staff/members/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /FROM memberships m[\s\S]*JOIN staff_members s/);
  assert.match(route, /WHERE m\.organization_id = \?/);
  assert.match(route, /INSERT INTO memberships \(organization_id, member_email, role, active\)/);
  assert.match(route, /ON CONFLICT\(organization_id, member_email\)/);
  assert.match(route, /organizationId: ctx\.organizationId/);
});

test("tenant role or activation changes revoke existing sessions", async () => {
  const route = await read("app/api/staff/members/route.ts");
  assert.match(route, /membership\.role !== role/);
  assert.match(route, /Number\(membership\.active\) !== active/);
  assert.match(route, /DELETE FROM staff_sessions WHERE email = \?/);
});

test("existing global identity role is not overwritten by another tenant administrator", async () => {
  const route = await read("app/api/staff/members/route.ts");
  const conflict = route.slice(route.indexOf("ON CONFLICT(email) DO UPDATE SET"), route.indexOf("db.prepare(\n      `INSERT INTO memberships"));
  assert.doesNotMatch(conflict, /role=excluded\.role/);
  assert.doesNotMatch(conflict, /active=excluded\.active/);
});
