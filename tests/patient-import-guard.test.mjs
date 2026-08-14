import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

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

const UPSERT_SQL = `INSERT INTO patient_profiles
     (organization_id, phone_normalized, display_name, birth_year, birth_date, email, address, tags, notes, do_not_contact, updated_by, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(organization_id, phone_normalized) DO UPDATE SET
     display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE patient_profiles.display_name END,
     birth_year = CASE WHEN excluded.birth_year != 0 THEN excluded.birth_year ELSE patient_profiles.birth_year END,
     birth_date = CASE WHEN excluded.birth_date != '' THEN excluded.birth_date ELSE patient_profiles.birth_date END,
     email = CASE WHEN excluded.email != '' THEN excluded.email ELSE patient_profiles.email END,
     address = CASE WHEN excluded.address != '' THEN excluded.address ELSE patient_profiles.address END,
     notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE patient_profiles.notes END,
     updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`;

test("re-import with only phone+name preserves existing card fields", async () => {
  const db = await freshDb();
  db.prepare(UPSERT_SQL).run(1, "380971112233", "Іван Петренко", 1985, "1985-03-10", "ivan@example.com", "Київ, вул. Тестова 1", "", "нотатка", 0, "admin@clinic");
  db.prepare(UPSERT_SQL).run(1, "380971112233", "Іван Петренко", 0, "", "", "", "", "", 0, "registrar@clinic");
  const row = db.prepare("SELECT * FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = ?").get("380971112233");
  assert.equal(row.birth_date, "1985-03-10");
  assert.equal(row.birth_year, 1985);
  assert.equal(row.email, "ivan@example.com");
  assert.equal(row.address, "Київ, вул. Тестова 1");
  assert.equal(row.notes, "нотатка");
});

test("same phone can coexist independently in two tenants", async () => {
  const db = await freshDb();
  db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'second', 'Second', 1)").run();
  db.prepare(UPSERT_SQL).run(1, "380971112233", "Org One", 1985, "", "one@example.com", "", "", "", 0, "one@staff");
  db.prepare(UPSERT_SQL).run(2, "380971112233", "Org Two", 1990, "", "two@example.com", "", "", "", 0, "two@staff");
  const rows = db.prepare("SELECT organization_id, display_name, email FROM patient_profiles WHERE phone_normalized = ? ORDER BY organization_id").all("380971112233");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.organization_id, r.display_name, r.email]), [[1, "Org One", "one@example.com"], [2, "Org Two", "two@example.com"]]);
});

test("import route uses the tenant composite conflict target", async () => {
  const route = await readFile(new URL("../app/api/staff/patients/import/route.ts", import.meta.url), "utf8");
  assert.match(route, /ON CONFLICT\(organization_id, phone_normalized\)/);
  for (const col of ["birth_date", "email", "address"]) assert.match(route, new RegExp(`${col} = CASE WHEN excluded.${col} != ''`));
  assert.match(route, /birth_year = CASE WHEN excluded\.birth_year != 0/);
});
