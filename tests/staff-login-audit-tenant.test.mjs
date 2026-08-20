import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff login audit derives tenant ownership instead of hardcoding org1", async () => {
  const login = await read("app/api/staff/login/route.ts");

  assert.match(login, /async function authAuditOrganizationIds/);
  assert.match(login, /FROM memberships m[\s\S]*JOIN organizations o ON o\.id = m\.organization_id/);
  assert.match(login, /activeOnly \? "AND m\.active = 1 AND o\.active = 1" : ""/);
  assert.match(login, /SELECT id AS organizationId FROM organizations WHERE active = 1 ORDER BY id LIMIT 2/);
  assert.match(login, /await auditAuthEvent\(db/);
  assert.doesNotMatch(login, /organizationId:\s*1/);
});

test("unknown multi-org login is not assigned to a fallback tenant", async () => {
  const login = await read("app/api/staff/login/route.ts");
  assert.match(login, /if \(activeOrganizations\.results\.length !== 1\) return \[\]/);
  assert.match(login, /allowSingleOrgFallback: !member \|\| Number\(accessState\?\.membershipCount\) === 0/);
});
