import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("auth migration adds password hashing and a sessions table", async () => {
  const migration = await read("drizzle/0008_staff_auth.sql");
  assert.match(migration, /ALTER TABLE `staff_members` ADD COLUMN `password_hash`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `staff_sessions`/);
  assert.match(migration, /`token_hash` text PRIMARY KEY/);
  assert.match(migration, /pbkdf2\$sha256\$/); // seeded admin password hash
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((entry) => entry.tag === "0008_staff_auth"));
  const schema = await read("db/schema.ts");
  assert.match(schema, /export const staffSessions = sqliteTable\("staff_sessions"/);
  assert.match(schema, /passwordHash: text\("password_hash"\)/);
});

test("auth library stores PBKDF2 hashes and hashed session tokens", async () => {
  const source = await read("lib/auth.ts");
  for (const fn of ["hashPassword", "verifyPassword", "newSessionToken", "hashToken", "sessionCookie", "clearedSessionCookie", "readCookie"]) {
    assert.match(source, new RegExp(`export (?:async )?function ${fn}`));
  }
  assert.match(source, /PBKDF2/);
  assert.match(source, /HttpOnly; Secure; SameSite=Lax/);
});

test("requireStaff resolves the member from a session cookie, not an external header", async () => {
  const source = await read("lib/staff-auth.ts");
  assert.match(source, /readCookie\(request, SESSION_COOKIE\)/);
  assert.match(source, /FROM staff_sessions s/);
  assert.match(source, /expires_at > CURRENT_TIMESTAMP/);
  assert.doesNotMatch(source, /oai-authenticated/i);
  assert.match(source, /export async function createSession/);
  assert.match(source, /export async function destroySession/);
});

test("login and logout endpoints verify credentials, rate-limit and manage the cookie", async () => {
  const login = await read("app/api/staff/login/route.ts");
  const logout = await read("app/api/staff/logout/route.ts");
  assert.match(login, /verifyPassword\(/);
  assert.match(login, /createSession\(/);
  assert.match(login, /isRateLimited\(/);
  assert.match(login, /set-cookie/i);
  assert.match(login, /Невірний email або пароль/);
  assert.match(logout, /destroySession\(/);
  assert.match(logout, /clearedSessionCookie\(/);
});

test("no ChatGPT sign-in remains anywhere in the app", async () => {
  for (const file of [
    "app/page.tsx", "app/layout.tsx", "app/robots.ts", "app/sitemap.ts",
    "app/staff/page.tsx", "app/staff/protocols/page.tsx", "app/staff/patients/page.tsx",
    "app/staff/imaging/page.tsx", "app/staff/dashboard/page.tsx", "app/staff/reports/page.tsx",
    "lib/staff-auth.ts", "README.md",
  ]) {
    const source = await read(file);
    assert.doesNotMatch(source, /chatgpt/i, `${file} still mentions ChatGPT`);
    assert.doesNotMatch(source, /signin-with/i, `${file} still links the ChatGPT sign-in`);
  }
});

async function renderPath(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("the self-managed login page renders", async () => {
  const response = await renderPath("/staff/login");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Кабінет персоналу/);
  assert.match(html, /Пароль/);
});

test("self-service migration seeds an access code and re-asserts the admin", async () => {
  const migration = await read("drizzle/0009_staff_self_service.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `app_settings`/);
  assert.match(migration, /registration_code_hash/);
  assert.match(migration, /pbkdf2\$sha256\$/);
  assert.match(migration, /password_hash` IS NULL OR/); // only re-set when unset
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((entry) => entry.tag === "0009_staff_self_service"));
});

test("account helpers enforce access code, email and password rules", async () => {
  const source = await read("lib/staff-accounts.ts");
  assert.match(source, /export async function verifyAccessCode/);
  assert.match(source, /export async function registerStaff/);
  assert.match(source, /export async function resetStaffPassword/);
  assert.match(source, /export function passwordProblem/);
  assert.match(source, /await hashPassword\(/);
  // a reset revokes existing sessions so old devices are logged out
  assert.match(source, /DELETE FROM staff_sessions WHERE email = \?/);
});

test("register and reset endpoints gate on the department access code", async () => {
  const register = await read("app/api/staff/register/route.ts");
  const reset = await read("app/api/staff/reset/route.ts");
  for (const route of [register, reset]) {
    assert.match(route, /verifyAccessCode\(/);
    assert.match(route, /isRateLimited\(/);
    assert.match(route, /Невірний код доступу відділення/);
  }
  assert.match(register, /set-cookie/i); // registration signs the member in
  assert.match(register, /emailTaken\(/);
});

test("login page exposes the eye toggle, registration and reset links", async () => {
  const response = await renderPath("/staff/login");
  const html = await response.text();
  assert.match(html, /passwordEye/);
  assert.match(html, /href=["']\/staff\/register["']/);
  assert.match(html, /href=["']\/staff\/forgot["']/);
});

test("registration and password-reset pages render", async () => {
  const register = await renderPath("/staff/register");
  assert.equal(register.status, 200);
  assert.match(await register.text(), /Код доступу відділення/);
  const forgot = await renderPath("/staff/forgot");
  assert.equal(forgot.status, 200);
  assert.match(await forgot.text(), /Відновлення пароля/);
});
