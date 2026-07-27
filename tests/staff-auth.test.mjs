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
