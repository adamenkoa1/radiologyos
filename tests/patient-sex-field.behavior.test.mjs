// Поле статі пацієнта (A: реальні пацієнти). Сумісна міграція (колонка + CHECK),
// API round-trip через реальний воркер (створення/редагування/читання), серверна
// валідація значення, і наявність поля у формах створення й редагування.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function put(db, cookie, body) {
  return callWorker(jsonRequest("/api/staff/patients", body, { method:"PUT", headers:{ cookie } }), db);
}

test("migration adds patient_profiles.sex with a safe default and a value CHECK", async () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map((x) => x.trim()).filter(Boolean)) db.exec(s);
  }
  const cols = db.prepare("PRAGMA table_info(patient_profiles)").all();
  const sexCol = cols.find((c) => c.name === "sex");
  assert.ok(sexCol, "sex column exists");
  assert.equal(sexCol.dflt_value.replace(/'/g, ""), "", "default is empty (не вказано)");
  // наявні картки не ламаються (дефолт застосовується), валідне значення лягає
  db.prepare("INSERT INTO patient_profiles (phone_normalized, display_name, updated_by) VALUES (?,?,?)")
    .run("380991234567", "Без статі", "admin");
  db.prepare("INSERT INTO patient_profiles (phone_normalized, display_name, sex, updated_by) VALUES (?,?,?,?)")
    .run("380991234568", "Жінка", "female", "admin");
  // DB-рівневий CHECK відхиляє сміття
  assert.throws(() => db.prepare("INSERT INTO patient_profiles (phone_normalized, display_name, sex, updated_by) VALUES (?,?,?,?)")
    .run("380991234569", "Погане", "zzz", "admin"), /CHECK|constraint/i);
});

test("create persists sex and GET reads it back; update changes it", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"reg-sex@example.com", role:"registrar", organizationId:1 });
    const created = await put(db, cookie, { phone:"+380501110011", displayName:"Пацієнт Стать", birthDate:"1990-05-05", sex:"female" });
    assert.equal(created.status, 200);
    const body = await created.json();
    assert.equal(body.profile.sex, "female", "sex persisted on create");
    const patientId = body.profile.patientId;

    const updated = await put(db, cookie, { patientId, phone:"+380501110011", displayName:"Пацієнт Стать", sex:"male" });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).profile.sex, "male", "sex updated");

    // стать читається назад через точковий GET картки (?patientId=)
    const card = await callWorker(new Request(`http://localhost/api/staff/patients?patientId=${patientId}`, { headers:{ cookie } }), db);
    assert.equal(card.status, 200);
    assert.equal((await card.json()).profile.sex, "male", "sex returned by profile read");
  });
});

test("server rejects an invalid sex value and accepts clearing it to empty", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"reg-sex2@example.com", role:"registrar", organizationId:1 });
    const bad = await put(db, cookie, { phone:"+380501110012", displayName:"Невірно", sex:"attack" });
    assert.equal(bad.status, 400, "invalid sex rejected server-side");

    const ok = await put(db, cookie, { phone:"+380501110012", displayName:"Порожньо", sex:"" });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).profile.sex, "", "empty sex accepted");
  });
});

test("sanitizeProfile validates sex against the allowed set", async () => {
  const src = await read("lib/patients.ts");
  assert.match(src, /PATIENT_SEX_VALUES/);
  assert.match(src, /Некоректне значення статі пацієнта/);
  assert.match(src, /sex, email:emailRaw, address/); // sex carried into the validated profile
});

test("both create and edit patient forms expose a sex selector; API writes/reads sex", async () => {
  const page = await read("app/staff/patients/page.tsx");
  // селектор у формах (двічі: створення + редагування)
  assert.ok((page.match(/name="sex"/g) || []).length >= 2, "sex selector in both forms");
  assert.match(page, /SEX_OPTIONS/);
  assert.match(page, /sex:String\(data\.get\("sex"\) \|\| ""\)/);
  const route = await read("app/api/staff/patients/route.ts");
  assert.match(route, /birth_date, sex,/); // PROFILE_COLUMNS select includes sex
  assert.match(route, /profile\.sex/); // written in insert + update
});
