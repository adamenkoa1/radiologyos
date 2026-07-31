import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Регресія: повторний імпорт CSV лише з телефон+ПІБ раніше затирав раніше
// введені поля картки (birth_date/email/address/birth_year). Тепер кожне
// поле оновлюється лише коли нове значення непорожнє.

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
     (phone_normalized, display_name, birth_year, birth_date, email, address, tags, notes, do_not_contact, updated_by, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(phone_normalized) DO UPDATE SET
     display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE patient_profiles.display_name END,
     birth_year = CASE WHEN excluded.birth_year != 0 THEN excluded.birth_year ELSE patient_profiles.birth_year END,
     birth_date = CASE WHEN excluded.birth_date != '' THEN excluded.birth_date ELSE patient_profiles.birth_date END,
     email = CASE WHEN excluded.email != '' THEN excluded.email ELSE patient_profiles.email END,
     address = CASE WHEN excluded.address != '' THEN excluded.address ELSE patient_profiles.address END,
     notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE patient_profiles.notes END,
     updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`;

test("re-import with only phone+name preserves existing card fields", async () => {
  const db = await freshDb();
  // Перший імпорт — повна картка.
  db.prepare(UPSERT_SQL).run(
    "380971112233", "Іван Петренко", 1985, "1985-03-10", "ivan@example.com", "Київ, вул. Тестова 1",
    "", "нотатка", 0, "admin@clinic",
  );
  // Повторний імпорт того ж телефону — лише ПІБ, решта порожня.
  db.prepare(UPSERT_SQL).run(
    "380971112233", "Іван Петренко", 0, "", "", "",
    "", "", 0, "registrar@clinic",
  );
  const row = db.prepare("SELECT * FROM patient_profiles WHERE phone_normalized = ?").get("380971112233");
  assert.equal(row.birth_date, "1985-03-10", "дата народження збережена");
  assert.equal(row.birth_year, 1985, "рік народження збережений");
  assert.equal(row.email, "ivan@example.com", "email збережений");
  assert.equal(row.address, "Київ, вул. Тестова 1", "адреса збережена");
  assert.equal(row.notes, "нотатка", "нотатка збережена");
  assert.equal(row.display_name, "Іван Петренко");
});

test("re-import with new non-empty values does overwrite", async () => {
  const db = await freshDb();
  db.prepare(UPSERT_SQL).run(
    "380971112233", "Іван П.", 1985, "1985-03-10", "old@example.com", "Стара адреса",
    "", "", 0, "admin@clinic",
  );
  db.prepare(UPSERT_SQL).run(
    "380971112233", "Іван Петренко", 1986, "1986-04-11", "new@example.com", "Нова адреса",
    "", "", 0, "admin@clinic",
  );
  const row = db.prepare("SELECT * FROM patient_profiles WHERE phone_normalized = ?").get("380971112233");
  assert.equal(row.birth_date, "1986-04-11");
  assert.equal(row.birth_year, 1986);
  assert.equal(row.email, "new@example.com");
  assert.equal(row.address, "Нова адреса");
  assert.equal(row.display_name, "Іван Петренко");
});

test("import route source guards each card field on conflict", async () => {
  const route = await readFile(new URL("../app/api/staff/patients/import/route.ts", import.meta.url), "utf8");
  for (const col of ["birth_date", "email", "address"]) {
    assert.match(route, new RegExp(`${col} = CASE WHEN excluded.${col} != ''`), `${col} guarded`);
  }
  assert.match(route, /birth_year = CASE WHEN excluded\.birth_year != 0/);
});
