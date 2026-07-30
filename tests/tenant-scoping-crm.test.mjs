import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Tenant-isolation для реєстру пацієнтів: patients/export/chat/ai-draft
// тепер фільтрують по organization_id. Тут перевіряємо, що SQL справді
// не показує дані іншої організації, і що маршрути беруть org із контексту.

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function freshDb() {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map((x) => x.trim()).filter(Boolean)) db.exec(s);
  }
  return db;
}

function seedTwoOrgs(db) {
  const ins = db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, service, desired_date, desired_time, status)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  ins.run(1, "RD-ORG1", "Пацієнт Один", "0971111111", "380971111111", "КТ", "2026-08-01", "09:00", "confirmed");
  ins.run(2, "RD-ORG2", "Пацієнт Два", "0972222222", "380972222222", "КТ", "2026-08-02", "10:00", "confirmed");
  db.prepare(
    `INSERT INTO patient_communications (organization_id, phone_normalized, channel, direction, summary, actor)
     VALUES (?,?, 'whatsapp', 'inbound', ?, 'patient')`
  ).run(1, "380971111111", "Привіт від org1");
  db.prepare(
    `INSERT INTO patient_communications (organization_id, phone_normalized, channel, direction, summary, actor)
     VALUES (?,?, 'whatsapp', 'inbound', ?, 'patient')`
  ).run(2, "380972222222", "Привіт від org2");
}

test("registry booking query returns only the caller's organization", async () => {
  const db = await freshDb();
  seedTwoOrgs(db);
  const rows = db.prepare(
    "SELECT code FROM bookings WHERE phone_normalized != '' AND organization_id = ? LIMIT 3000"
  ).all(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, "RD-ORG1");
});

test("chat conversations are scoped to the caller's organization", async () => {
  const db = await freshDb();
  seedTwoOrgs(db);
  const rows = db.prepare(
    "SELECT summary FROM patient_communications WHERE organization_id = ? AND channel = 'whatsapp'"
  ).all(2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary, "Привіт від org2");
});

test("patient-registry routes derive organization from the server context", async () => {
  for (const path of [
    "app/api/staff/patients/route.ts",
    "app/api/staff/patients/export/route.ts",
    "app/api/staff/chat/route.ts",
    "app/api/staff/ai/protocol-draft/route.ts",
  ]) {
    const route = await read(path);
    assert.match(route, /requireOrgContext\(request, db\)/, `${path} uses org context`);
    assert.match(route, /organization_id = \?/, `${path} filters by org`);
    assert.doesNotMatch(route, /requireStaff\(/, `${path} no longer uses unscoped requireStaff`);
  }
});

test("ai protocol draft passes organizationId to the booking access guard", async () => {
  const route = await read("app/api/staff/ai/protocol-draft/route.ts");
  assert.match(route, /canAccessBooking\(db, member, bookingId, ctx\.organizationId\)/);
});
