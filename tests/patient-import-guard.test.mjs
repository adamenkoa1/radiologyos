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

test("shared phone migration keeps existing profile data and removes phone uniqueness", async () => {
  const db = await freshDb();
  db.prepare(
    `INSERT INTO patient_profiles
      (organization_id, phone_normalized, display_name, birth_year, birth_date, email, address, notes, updated_by)
     VALUES (1, ?, 'Іван Петренко', 1985, '1985-03-10', 'ivan@example.com', 'Київ', 'нотатка', 'admin')`,
  ).run("380971112233");
  const first = db.prepare(
    "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = ?",
  ).get("380971112233");
  db.prepare(
    `INSERT INTO patient_profiles
      (organization_id, phone_normalized, display_name, birth_year, updated_by)
     VALUES (1, ?, 'Марія Петренко', 1990, 'registrar')`,
  ).run("380971112233");

  const rows = db.prepare(
    `SELECT patient_id AS patientId, display_name AS displayName, birth_date AS birthDate,
            email, address, notes
     FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = ?
     ORDER BY display_name`,
  ).all("380971112233");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].patientId, rows[1].patientId);
  const ivan = rows.find((row) => row.patientId === first.patientId);
  assert.equal(ivan.birthDate, "1985-03-10");
  assert.equal(ivan.email, "ivan@example.com");
  assert.equal(ivan.address, "Київ");
  assert.equal(ivan.notes, "нотатка");
});

test("same phone can coexist independently across and within tenants", async () => {
  const db = await freshDb();
  db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'second', 'Second', 1)").run();
  for (const [org, name] of [[1, "Org One A"], [1, "Org One B"], [2, "Org Two"]]) {
    db.prepare(
      `INSERT INTO patient_profiles (organization_id, phone_normalized, display_name, updated_by)
       VALUES (?, '380971112233', ?, 'seed')`,
    ).run(org, name);
  }
  const rows = db.prepare(
    "SELECT organization_id AS org, display_name AS name FROM patient_profiles WHERE phone_normalized = ? ORDER BY organization_id, display_name",
  ).all("380971112233");
  assert.deepEqual(rows.map((r) => [r.org, r.name]), [
    [1, "Org One A"], [1, "Org One B"], [2, "Org Two"],
  ]);
});

test("import route updates only explicit patient_id and never upserts by phone", async () => {
  const route = await readFile(new URL("../app/api/staff/patients/import/route.ts", import.meta.url), "utf8");
  assert.match(route, /const patientId =/);
  assert.match(route, /WHERE organization_id = \? AND patient_id = \?/);
  assert.match(route, /crypto\.randomUUID\(\)\.replace/);
  assert.match(route, /INSERT INTO patient_profiles/);
  assert.doesNotMatch(route, /ON CONFLICT\(organization_id, phone_normalized\)/);
  assert.match(route, /display_name = CASE WHEN \? != '' THEN \? ELSE display_name END/);
  assert.match(route, /birth_date = CASE WHEN \? != '' THEN \? ELSE birth_date END/);
  assert.match(route, /email = CASE WHEN \? != '' THEN \? ELSE email END/);
});
