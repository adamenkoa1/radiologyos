import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard authorization uses tenant membership role without org-1 fallback", async () => {
  const route = await read("app/api/staff/dashboard/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /ctx\.role !== "admin"/);
  assert.match(route, /const orgId = ctx\.organizationId/);
  assert.doesNotMatch(route, /requireStaff\(/);
  assert.doesNotMatch(route, /organizationId \?\? 1|organizationId \|\| 1/);
});
