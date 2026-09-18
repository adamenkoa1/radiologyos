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
    for (const stmt of sql.split(/-->\s*statement-breakpoint/).map((s) => s.trim()).filter(Boolean)) db.exec(stmt);
  }
  return db;
}

const insertBooking = (db, orgId, code, extra = {}) => db.prepare(
  `INSERT INTO bookings (organization_id, code, name, phone, service, service_code, equipment_id,
    duration_minutes, desired_date, desired_time, referral, patient_category, referral_type,
    assigned_radiologist_email)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
).run(orgId, code, "П", "0", "КТ", "01", "ct", 30, "2026-08-01", "09:00", "r", "civilian", "other", extra.radiologist || "");

// Область видимості заявок обмежена організацією ще до ролі: персонал
// не бачить заявок іншого tenant навіть як admin.
test("booking read scope is organization-first", async () => {
  const db = await migratedDb();
  db.prepare("INSERT INTO organizations (id, slug, name) VALUES (2,'ct','КТ')").run();
  insertBooking(db, 1, "A1");
  insertBooking(db, 2, "B1");

  // Модель запиту з route: organization_id = ? AND (роль). Для admin роль = 1=1.
  const org1 = db.prepare("SELECT code FROM bookings WHERE organization_id = ? AND (1 = 1) ORDER BY id").all(1);
  assert.deepEqual(org1.map((r) => r.code), ["A1"]);
  const org2 = db.prepare("SELECT code FROM bookings WHERE organization_id = ? AND (1 = 1) ORDER BY id").all(2);
  assert.deepEqual(org2.map((r) => r.code), ["B1"]);
});

// canAccessBooking з organizationId відкидає заявку іншої організації навіть
// за прямим id (модель SQL-перевірки).
test("cross-tenant booking is inaccessible by direct id", async () => {
  const db = await migratedDb();
  db.prepare("INSERT INTO organizations (id, slug, name) VALUES (2,'ct','КТ')").run();
  insertBooking(db, 2, "B1");
  const foreignId = db.prepare("SELECT id FROM bookings WHERE code = 'B1'").get().id;

  // admin/registrar шлях: SELECT id ... WHERE id = ? AND organization_id = ?
  const asOrg1 = db.prepare("SELECT id FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1").get(foreignId, 1);
  assert.equal(asOrg1, undefined, "org 1 cannot access org 2 booking");
  const asOrg2 = db.prepare("SELECT id FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1").get(foreignId, 2);
  assert.ok(asOrg2, "own org can access");
});

// Джерело коду: маршрут заявок tenant-scoped, доступ звірено з організацією.
test("bookings route derives tenant from session and org-scopes access", async () => {
  const route = await read("app/api/staff/bookings/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /bookingScope\(member, ctx\.organizationId\)/);
  assert.match(route, /organization_id = \? AND \(\$\{role\.sql\}\)/);
  assert.match(route, /canAccessBooking\(db, member, body\.id!, ctx\.organizationId\)/);
  // Старий небезпечний скоуп без організації прибрано.
  assert.doesNotMatch(route, /function bookingScope\(member: \{ email: string; role: StaffRole \}\)\s*\{/);
});

// Security primitive вимагає tenant завжди: немає optional organizationId
// і немає admin/registrar fast-path, який повертає true без перевірки заявки.
test("canAccessBooking requires organization and fails closed", async () => {
  const src = await read("lib/staff-auth.ts");
  assert.match(src, /organizationId: number/);
  assert.doesNotMatch(src, /organizationId\?: number/);
  assert.match(src, /!Number\.isInteger\(organizationId\) \|\| organizationId <= 0/);
  assert.match(src, /WHERE id = \? AND organization_id = \? LIMIT 1/);
  assert.doesNotMatch(src, /organizationId == null\) return true/);
});

// Протоколи: доступ і черга org-scoped.
test("protocols route is tenant-scoped", async () => {
  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /canAccessBooking\(db, member, bookingId, ctx\.organizationId\)/);
  // Черга протоколів фільтрує організацію.
  assert.match(route, /b\.organization_id = \?/);
  assert.doesNotMatch(route, /requireStaff/);
});

// Аналітика: джерело звіту й експорт org-scoped.
test("reports are tenant-scoped", async () => {
  const source = await read("lib/reporting-server.ts");
  assert.match(source, /fetchReportSource\(db:D1Database,filters:ReportFilters,organizationId:number\)/);
  assert.match(source, /b\.organization_id = \?/);
  for (const path of ["app/api/staff/reports/route.ts", "app/api/staff/reports/export/route.ts"]) {
    const route = await read(path);
    assert.match(route, /requireOrgContext\(request,db\)/);
    assert.match(route, /fetchReportSource\(db,filters,ctx\.organizationId\)/);
    assert.doesNotMatch(route, /requireStaff/);
  }
  const exportRoute = await read("app/api/staff/reports/export/route.ts");
  assert.match(exportRoute, /INSERT INTO report_exports \(\s*\n?\s*organization_id/);
});

// Знімки: доступ, worklist і запис студії org-scoped.
test("imaging route is tenant-scoped end-to-end", async () => {
  const route = await read("app/api/staff/imaging/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /canAccessBooking\(db, member, bookingId, ctx\.organizationId\)/);
  // worklist і перевірка заявки обмежені організацією.
  assert.match(route, /b\.organization_id = \?/);
  assert.match(route, /FROM bookings WHERE id = \? AND organization_id = \?/);
  // Нова студія несе organization_id.
  assert.match(route, /INSERT INTO imaging_studies\s*\n?\s*\(organization_id, booking_id/);
  assert.doesNotMatch(route, /requireStaff/);
});
