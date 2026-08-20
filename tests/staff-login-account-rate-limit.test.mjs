import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff login uses independent IP and account rate-limit buckets", async () => {
  const login = await read("app/api/staff/login/route.ts");

  assert.match(login, /isRateLimited\(db, request, "staff-login"/);
  assert.match(login, /isIdentifierRateLimited\([\s\S]*"staff-login-account"/);
  assert.match(login, /recordIdentifierRateLimitFailure\([\s\S]*"staff-login-account"/);
  assert.match(login, /clearIdentifierRateLimit\(db, "staff-login-account", loginIdentifier\)/);
  assert.match(login, /phone:\$\{phone\}/);
  assert.match(login, /email:\$\{email\}/);

  const checkIndex = login.indexOf("isIdentifierRateLimited(");
  const verifyIndex = login.indexOf("verifyPassword(password");
  const recordIndex = login.indexOf("recordIdentifierRateLimitFailure(");
  assert.ok(checkIndex >= 0 && checkIndex < verifyIndex, "account lockout must be checked before password verification");
  assert.ok(recordIndex > verifyIndex, "only failed credential verification should consume the account failure bucket");
});

test("account rate-limit keys are hashed and never stored as raw identifiers", async () => {
  const limiter = await read("lib/rate-limit.ts");

  assert.match(limiter, /identifierFingerprint/);
  assert.match(limiter, /digestKey\(`\$\{scope\}:identifier:\$\{identifier\.trim\(\)\.toLowerCase\(\)\}`\)/);
  assert.match(limiter, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(limiter, /export async function isIdentifierRateLimited/);
  assert.match(limiter, /export async function recordIdentifierRateLimitFailure/);
  assert.match(limiter, /export async function clearIdentifierRateLimit/);
  assert.doesNotMatch(limiter, /INSERT INTO request_limits[^\n]*identifier/i);
});

test("successful staff login clears only the account failure bucket", async () => {
  const login = await read("app/api/staff/login/route.ts");
  const clearIndex = login.indexOf("clearIdentifierRateLimit(db, \"staff-login-account\", loginIdentifier)");
  const successAuditIndex = login.indexOf('action: "login", resource: "auth"');

  assert.ok(clearIndex >= 0, "successful login must clear accumulated account failures");
  assert.ok(successAuditIndex > clearIndex, "account failures must be cleared on the verified-success path");
});
