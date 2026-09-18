import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff login issues sessions only to identities with active tenant access", async () => {
  const login = await read("app/api/staff/login/route.ts");

  assert.match(login, /FROM memberships m[\s\S]*JOIN organizations o ON o\.id = m\.organization_id AND o\.active = 1/);
  assert.match(login, /m\.member_email = \? AND m\.active = 1/);
  assert.match(login, /const hasTenantAccess = Boolean/);
  assert.match(login, /!member \|\| !ok \|\| !hasTenantAccess/);
  assert.match(login, /no_active_membership/);

  const accessCheck = login.indexOf("const hasTenantAccess = Boolean");
  const sessionIssue = login.indexOf("createSession(db, member.email)");
  assert.ok(accessCheck >= 0 && sessionIssue > accessCheck, "tenant access must be checked before a staff session is issued");
});

test("membership-disabled login is not counted as a wrong-PIN failure", async () => {
  const login = await read("app/api/staff/login/route.ts");
  assert.match(login, /if \(!member \|\| !ok\) \{[\s\S]*recordIdentifierRateLimitFailure/);
  assert.doesNotMatch(login, /if \(!member \|\| !ok \|\| !hasTenantAccess\) \{\s*await recordIdentifierRateLimitFailure/);
});
