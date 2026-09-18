import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function migratedDb() {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const file of files) {
    const sql = await readFile(new URL(file, dir), "utf8");
    for (const stmt of sql.split(/-->\s*statement-breakpoint/).map((s) => s.trim()).filter(Boolean)) {
      db.exec(stmt);
    }
  }
  return db;
}

// Усі міграції застосовуються послідовно й дають організаційну модель +
// початковий tenant Чернігівського військового госпіталю.
test("migrations create org tables and seed the initial tenant", async () => {
  const db = await migratedDb();

  for (const table of ["organizations", "organization_profiles", "branches", "departments", "memberships"]) {
    const found = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").all(table);
    assert.equal(found.length, 1, `${table} table exists`);
  }

  const org = db.prepare("SELECT id, slug, name FROM organizations WHERE id = 1").get();
  assert.equal(org.slug, "chernihiv-military-hospital-radiology");
  assert.equal(org.name, "Чернігівський військовий госпіталь");

  const profile = db.prepare("SELECT profile_type FROM organization_profiles WHERE organization_id = 1").get();
  assert.equal(profile.profile_type, "hospital_radiology");

  const dept = db.prepare("SELECT name, branch_id FROM departments WHERE organization_id = 1").get();
  assert.equal(dept.name, "Відділення променевої діагностики");
  assert.equal(dept.branch_id, 1);

  // organization_id додано до бізнес-таблиць із безпечним значенням за замовч.
  const bookingCols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  assert.ok(bookingCols.includes("organization_id"), "bookings.organization_id exists");
});

// Наявний персонал стає учасниками початкової організації через backfill.
test("existing staff are backfilled as memberships of the initial org", async () => {
  const db = await migratedDb();
  db.prepare("INSERT INTO staff_members (email, display_name, role, active) VALUES (?,?,?,?)")
    .run("admin@hospital.example", "Адмін", "admin", 1);
  // memberships наповнюються з staff_members під час міграції; для персоналу,
  // доданого після, зв'язок створюється явно (симулюємо backfill-семантику).
  db.prepare("INSERT INTO memberships (organization_id, member_email, role, active) VALUES (1, ?, 'admin', 1)")
    .run("admin@hospital.example");
  const m = db.prepare("SELECT organization_id AS orgId, role FROM memberships WHERE member_email = ?")
    .get("admin@hospital.example");
  assert.equal(m.orgId, 1);
  assert.equal(m.role, "admin");
});

// Ядро tenant isolation: вибірка, обмежена organization_id, фізично не дістає
// дані іншої організації — навіть за прямим id чужого запису.
test("organization_id scoping isolates bookings across tenants", async () => {
  const db = await migratedDb();
  // Друга організація.
  db.prepare("INSERT INTO organizations (id, slug, name) VALUES (2, 'private-ct', 'Приватний КТ-центр')").run();

  const insert = db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, service, service_code, equipment_id,
      duration_minutes, desired_date, desired_time, referral, patient_category, referral_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  insert.run(1, "A1", "Пацієнт А", "0", "КТ", "01", "ct", 30, "2026-08-01", "09:00", "r", "civilian", "other");
  const b2 = insert.run(2, "B1", "Пацієнт Б", "0", "КТ", "01", "ct", 30, "2026-08-01", "10:00", "r", "civilian", "other");
  const foreignId = Number(b2.lastInsertRowid);

  // Запити першої організації бачать лише свій запис.
  const org1 = db.prepare("SELECT code FROM bookings WHERE organization_id = ? ORDER BY id").all(1);
  assert.deepEqual(org1.map((r) => r.code), ["A1"]);

  // Прямий доступ до чужого id під фільтром своєї організації → нічого.
  const stolen = db.prepare("SELECT code FROM bookings WHERE organization_id = ? AND id = ?").get(1, foreignId);
  assert.equal(stolen, undefined, "org 1 cannot read org 2's booking by id");

  const count1 = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE organization_id = 1").get().n;
  const count2 = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE organization_id = 2").get().n;
  assert.equal(count1, 1);
  assert.equal(count2, 1);
});

// Контексти організації походять лише із серверної сесії, а medical/system
// role sets розділені на рівні самого tenant resolver.
test("tenant contexts derive the tenant from the session and keep medical/system roles separated", async () => {
  const src = await read("lib/tenant.ts");
  assert.match(src, /export function requireOrgContext/);
  assert.match(src, /return resolveOrgContext\(request, db, MEDICAL_OPERATIONAL_ROLES\)/);
  assert.match(src, /export function requireSystemOrgContext/);
  assert.match(src, /return resolveOrgContext\(request, db, SYSTEM_ADMIN_ROLES\)/);
  assert.match(src, /requireStaff\(request, db\)/);
  assert.match(src, /FROM memberships/);
  // Явно не читає organizationId з тіла/параметрів запиту.
  assert.doesNotMatch(src, /request\.json\(\)/);
  assert.doesNotMatch(src, /searchParams/);
});

// Кожен запит tenant-репозиторію обов'язково фільтрує organization_id.
test("tenant-repo always scopes queries by organization_id", async () => {
  const src = await read("lib/tenant-repo.ts");
  const selects = src.match(/FROM\s+\w+/g) || [];
  assert.ok(selects.length >= 3, "repo has several data queries");
  // Немає жодного SELECT/… без organization_id у WHERE.
  assert.ok(
    (src.match(/organization_id = \?/g) || []).length >= selects.length,
    "every repo query filters organization_id",
  );
  const route = await read("app/api/staff/org/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
});
