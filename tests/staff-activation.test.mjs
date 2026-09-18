import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("activation token comparison is hashed and timing-safe", async () => {
  const source = await read("lib/staff-activation.ts");
  assert.match(source, /hashToken\(token\)/);
  assert.match(source, /timingSafeTextEqual/);
  assert.match(source, /STAFF_ACTIVATION_TOKEN_HASH = "[0-9a-f]{64}"/);
  assert.doesNotMatch(source, /STAFF_ACTIVATION_TOKEN\s*=/);
});

test("owner activation is one-time, provisions admin and starts a session", async () => {
  const route = await read("app/api/staff/activate/route.ts");
  assert.match(route, /INSERT OR IGNORE INTO app_settings/);
  assert.match(route, /staff_members/);
  assert.match(route, /memberships/);
  assert.match(route, /hashPassword\(password\)/);
  assert.match(route, /createSession\(db, email\)/);
  assert.match(route, /isRateLimited\(/);
  assert.match(route, /cache-control/);
});

test("activation page keeps the token in the URL fragment and lets the owner choose a fresh PIN", async () => {
  const page = await read("app/staff/activate/page.tsx");
  assert.match(page, /window\.location\.hash/);
  assert.match(page, /window\.history\.replaceState/);
  assert.match(page, /Новий PIN-код/);
  assert.match(page, /Повторіть PIN-код/);
  assert.match(page, /\/api\/staff\/activate/);
});
