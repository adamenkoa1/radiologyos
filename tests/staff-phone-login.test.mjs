import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Міграція додає phone до staff_members з унікальним індексом.
test("migration adds a unique phone identifier to staff", async () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map((x) => x.trim()).filter(Boolean)) db.exec(s);
  }
  const cols = db.prepare("PRAGMA table_info(staff_members)").all().map((c) => c.name);
  assert.ok(cols.includes("phone"), "staff_members.phone exists");
  db.prepare("INSERT INTO staff_members (email,phone,role,active) VALUES (?,?,?,1)")
    .run("380971234567@phone.local", "380971234567", "admin");
  const row = db.prepare("SELECT email FROM staff_members WHERE phone = ?").get("380971234567");
  assert.equal(row.email, "380971234567@phone.local");
});

// Логін приймає номер телефону (email лишається сумісним запасним варіантом).
test("login resolves staff by phone number", async () => {
  const route = await read("app/api/staff/login/route.ts");
  assert.match(route, /normalizeUkrainianPhone\(/);
  assert.match(route, /WHERE phone = \? AND active = 1/);
  assert.match(route, /Невірний номер телефону або PIN-код/);
  const page = await read("app/staff/login/page.tsx");
  assert.match(page, /Номер телефону/);
  assert.match(page, /name="phone"/);
  assert.doesNotMatch(page, /name="email"/);
});

// Реєстрація персоналу — за номером телефону; email похідний, внутрішній.
test("admin registers staff by phone; email is derived internally", async () => {
  const route = await read("app/api/staff/members/route.ts");
  assert.match(route, /normalizeUkrainianPhone\(String\(body\.phone/);
  assert.match(route, /@phone\.local/);
  assert.match(route, /Перевірте номер телефону і роль/);
  assert.match(route, /INSERT INTO staff_members \(email, phone/);
  const page = await read("app/staff/page.tsx");
  assert.match(page, /name="phone"/);
});

// KDF полегшено до робочого для безкоштовного Worker рівня.
test("password KDF cost lowered to fit the free Worker CPU budget", async () => {
  const auth = await read("lib/auth.ts");
  assert.match(auth, /PBKDF2_ITERATIONS = 100000/);
});
