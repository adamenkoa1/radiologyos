import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("patient profile schema keeps contact fields and immutable id", async () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map(x => x.trim()).filter(Boolean)) db.exec(s);
  }
  const cols = db.prepare("PRAGMA table_info(patient_profiles)").all().map(c => c.name);
  for (const c of ["patient_id", "birth_date", "email", "address"]) assert.ok(cols.includes(c), `has ${c}`);
  db.prepare("INSERT INTO patient_profiles (phone_normalized, display_name, birth_date, email, updated_by) VALUES (?,?,?,?,?)")
    .run("380971112233", "Марія", "1985-01-01", "m@e.co", "admin");
  const row = db.prepare("SELECT patient_id AS id, display_name AS n, birth_date AS d FROM patient_profiles WHERE phone_normalized = ?").get("380971112233");
  assert.match(row.id, /^[0-9a-f]{32}$/);
  assert.equal(row.n, "Марія");
  assert.equal(row.d, "1985-01-01");
});

test("sanitizeProfile handles full DOB, email and address and derives the year", async () => {
  const src = await read("lib/patients.ts");
  assert.match(src, /normalizeDob\(raw\.birthDate\)/);
  assert.match(src, /birthDate \? Number\(birthDate\.slice\(0, 4\)\)/);
  assert.match(src, /Некоректний email пацієнта/);
  assert.match(src, /birthDate, email:emailRaw, address/);
});

test("buildPatientSummaries lists profile-only patients by immutable id", async () => {
  const src = await read("lib/patients.ts");
  assert.match(src, /for \(const \[patientId, profile\] of profiles\)/);
  assert.match(src, /exactGroups\.get\(patientId\) \|\| \[\]/);
  assert.match(src, /summarizePatientRows\(exactGroups\.get\(patientId\) \|\| \[\], exactProfile/);
  assert.match(src, /hasProfile:!!profile/);
});

test("patients page exposes an add-patient form and uses exact selection keys", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /Додати пацієнта/);
  assert.match(page, /createPatient\(/);
  assert.match(page, /name="birthDate"/);
  assert.match(page, /name="address"/);
  assert.match(page, /patientKey\(item\.patientId, item\.phoneNormalized\)/);
  assert.match(page, /patientId:result\.profile\.patientId/);
});

test("profile write persists contact fields and updates by patient_id", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  assert.match(route, /birth_date, email, address/);
  assert.match(route, /birth_date AS birthDate, email, address/);
  assert.match(route, /WHERE organization_id = \? AND patient_id = \?/);
  assert.doesNotMatch(route, /ON CONFLICT\(organization_id, phone_normalized\)/);
});
