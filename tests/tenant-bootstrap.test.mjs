import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/tenant.ts", import.meta.url), "utf8");

test("tenant auto-enrollment is limited to an empty single-organization bootstrap", () => {
  assert.match(source, /SELECT COUNT\(\*\) FROM memberships/);
  assert.match(source, /SELECT COUNT\(\*\) FROM organizations WHERE active = 1/);
  assert.match(source, /Number\(bootstrap\.membershipCount\) !== 0/);
  assert.match(source, /Number\(bootstrap\.activeOrgCount\) !== 1/);
  assert.match(source, /ORDER BY id ASC LIMIT 1/);
});
