// Застосовує ВСІ D1-міграції до свіжої ЛОКАЛЬНОЇ SQLite-бази (node:sqlite) і
// засіває кілька СИНТЕТИЧНИХ рядків, щоб довести: схема застосовується чисто й
// приймає запис. Жодних реальних даних, жодної мережі, жодного Cloudflare.
//
// Призначення — PR-гейт і staging-прелюд: детермінована перевірка міграцій поза
// тестами, з інспектованим підсумком (stdout + GITHUB_STEP_SUMMARY + артефакт).
//
// Запуск:  node scripts/apply-d1-migrations-local.mjs [--report <file>]

import { DatabaseSync } from "node:sqlite";
import { readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DRIZZLE_DIR = new URL("../drizzle/", import.meta.url);
const reportFlag = process.argv.indexOf("--report");
const reportPath = reportFlag !== -1 ? process.argv[reportFlag + 1] : null;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const files = (await readdir(fileURLToPath(DRIZZLE_DIR)))
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (!files.length) fail("No D1 migrations found in drizzle/");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");

for (const file of files) {
  const sql = await readFile(new URL(file, DRIZZLE_DIR), "utf8");
  try {
    // 0093 навмисно містить deferred-FK перебудову — застосовуємо в транзакції,
    // як і поведінковий harness, щоб відповідати реальному порядку.
    if (file === "0093_study_correction_registrar.sql") {
      db.exec("BEGIN;");
      try { db.exec(sql); db.exec("COMMIT;"); }
      catch (e) { try { db.exec("ROLLBACK;"); } catch { /* no-op */ } throw e; }
    } else {
      db.exec(sql);
    }
  } catch (e) {
    fail(`Migration ${file} failed to apply locally: ${e.message}`);
  }
}

// Синтетичний запис — обидва ключові клінічні записи (пацієнт + дослідження).
// Явні маркери «SYNTHETIC CI», розведений слот (щоб не чіпати тригер ємності).
const SYNTH = "SYNTHETIC CI — not a real patient";
try {
  db.exec(
    `INSERT INTO patient_profiles (patient_id, organization_id, phone_normalized, display_name, sex, notes, updated_by)
     VALUES (lower(hex(randomblob(16))), 1, '380000000001', '${SYNTH}', 'other', '${SYNTH}', 'ci@example.com');`,
  );
  db.exec(
    `INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id,
       duration_minutes, desired_date, desired_time, anatomical_regions, contrast_method, status)
     VALUES (1, 'CI-SYNTH-1', '${SYNTH}', '380000000001', '380000000001', 'КТ органів грудної клітки', '407', 'ct',
       30, '2099-01-01', '09:00', 'chest', 'none', 'confirmed');`,
  );
} catch (e) {
  fail(`Synthetic seed write failed against the migrated schema: ${e.message}`);
}

// Перевірка: ключові таблиці існують і синтетичні рядки лягли.
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bookings','patient_profiles','protocols','intake_requests') ORDER BY name;",
).all().map((r) => r.name);
for (const t of ["bookings", "patient_profiles", "protocols", "intake_requests"]) {
  if (!tables.includes(t)) fail(`Expected table '${t}' is missing after migrations`);
}
const patients = db.prepare("SELECT COUNT(*) AS n FROM patient_profiles WHERE display_name = ?;").get(SYNTH).n;
const bookings = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE code = 'CI-SYNTH-1';").get().n;
if (patients !== 1 || bookings !== 1) fail(`Synthetic rows not persisted (patients=${patients}, bookings=${bookings})`);

const summary = [
  `# D1 local migration check`,
  ``,
  `- Migrations applied: **${files.length}**`,
  `- Latest migration: \`${files[files.length - 1].replace(/\.sql$/, "")}\``,
  `- Key tables present: ${["bookings", "patient_profiles", "protocols", "intake_requests"].join(", ")}`,
  `- Synthetic write (patient + study) accepted: ✅ (1 patient, 1 study, markers "${SYNTH}")`,
  `- Data source: ephemeral in-memory SQLite — no Cloudflare, no network, no real data.`,
].join("\n");

console.log(summary.replace(/^#.*$/m, "D1 local migration check").replace(/\*\*/g, ""));

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}
if (reportPath) {
  await writeFile(reportPath, summary + "\n");
}
db.close();
console.log("✓ All D1 migrations apply cleanly to a fresh local database and accept synthetic writes.");
