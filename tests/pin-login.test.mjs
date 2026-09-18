import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Політика коду доступу: 6-значний PIN валідний, надто короткий — ні.
test("password policy accepts a 6-digit PIN", async () => {
  const src = await read("lib/staff-accounts.ts");
  assert.match(src, /MIN_PASSWORD_LENGTH = 6/);
  assert.match(src, /PIN_RE = \/\^\\d\{6\}\$\//);
  // Немає старої вимоги «літера + цифра».
  assert.doesNotMatch(src, /щонайменше одну літеру/);
});

// Скрипт хешування приймає 6-значний PIN.
test("hash-password script accepts a 6-digit PIN", async () => {
  const src = await read("scripts/hash-password.mjs");
  assert.match(src, /\/\^\\d\{6\}\$\/\.test\(password\)/);
  assert.doesNotMatch(src, /length < 12/);
});

// Вхід — за PIN-кодом; форма й підказки оновлені.
test("login form asks for a 6-digit PIN", async () => {
  const page = await read("app/staff/login/page.tsx");
  assert.match(page, /PIN-код/);
  assert.match(page, /inputMode="numeric"/);
  assert.match(page, /maxLength=\{6\}/);
});

// Онбординг без ручних кроків: requireOrgContext автоприв'язує членство до
// початкової організації, якщо його ще немає.
test("requireOrgContext auto-attaches membership to the initial org", async () => {
  const src = await read("lib/tenant.ts");
  assert.match(src, /INSERT INTO memberships/);
  assert.match(src, /ON CONFLICT\(organization_id, member_email\)/);
  assert.match(src, /ORDER BY id ASC LIMIT 1/); // початкова організація
  // Джерело членства — усе одно сесія, не клієнт.
  assert.match(src, /requireStaff\(request, db\)/);
});
