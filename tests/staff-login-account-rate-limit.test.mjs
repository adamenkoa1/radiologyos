import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff login uses independent IP and canonical account rate-limit buckets", async () => {
  const login = await read("app/api/staff/login/route.ts");

  assert.match(login, /isRateLimited\(db, request, "staff-login"/);
  assert.match(login, /const submittedIdentifier = phone \? `phone:\$\{phone\}` : `email:\$\{email\}`/);
  assert.match(login, /const accountIdentifier = member \? `account:\$\{member\.email\.toLowerCase\(\)\}` : submittedIdentifier/);
  assert.match(login, /isIdentifierRateLimited\([\s\S]*"staff-login-account"[\s\S]*accountIdentifier/);
  assert.match(login, /recordIdentifierRateLimitFailure\([\s\S]*"staff-login-account"[\s\S]*accountIdentifier/);
  assert.match(login, /clearIdentifierRateLimit\(db, "staff-login-account", accountIdentifier\)/);

  const lookupIndex = login.indexOf("const member = phone");
  const checkIndex = login.indexOf("isIdentifierRateLimited(");
  const verifyIndex = login.indexOf("verifyPassword(password");
  const recordIndex = login.indexOf("recordIdentifierRateLimitFailure(");
  assert.ok(lookupIndex >= 0 && lookupIndex < checkIndex, "known aliases must resolve to the member before account throttling");
  assert.ok(checkIndex >= 0 && checkIndex < verifyIndex, "account lockout must be checked before password verification");
  assert.ok(recordIndex > verifyIndex, "only failed credential verification should consume the account failure bucket");
});

test("phone and email aliases share one known-account failure key", async () => {
  const login = await read("app/api/staff/login/route.ts");

  assert.match(login, /member \? `account:\$\{member\.email\.toLowerCase\(\)\}` : submittedIdentifier/);
  assert.doesNotMatch(login, /isIdentifierRateLimited\([\s\S]*loginIdentifier/);
  assert.doesNotMatch(login, /recordIdentifierRateLimitFailure\([\s\S]*loginIdentifier/);
  assert.doesNotMatch(login, /clearIdentifierRateLimit\([^\n]*loginIdentifier/);
});

test("unknown and blocked staff accounts do not expose an enumeration oracle", async () => {
  const login = await read("app/api/staff/login/route.ts");

  assert.match(login, /const ok = await verifyPassword\(password, member && !compromised \? member\.passwordHash : ""\)/);
  assert.match(login, /return Response\.json\(\{ error: "Невірний номер телефону або PIN-код" \}, \{ status: 401 \}\)/);
  assert.doesNotMatch(login, /Початковий PIN заблоковано/);
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

test("successful staff login clears the canonical account failure bucket", async () => {
  const login = await read("app/api/staff/login/route.ts");
  const clearIndex = login.indexOf("clearIdentifierRateLimit(db, \"staff-login-account\", accountIdentifier)");
  const successAuditIndex = login.indexOf('action: "login", resource: "auth"');

  assert.ok(clearIndex >= 0, "successful login must clear accumulated canonical account failures");
  assert.ok(successAuditIndex > clearIndex, "account failures must be cleared on the verified-success path");
});
