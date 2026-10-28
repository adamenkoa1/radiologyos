// Структуровані параметри дослідження: анатомічна ділянка (кілька) + метод
// контрастування (MP, блок A). Сумісна міграція (колонка + CHECK + дефолт),
// валідація/нормалізація канонічною таксономією, збереження через API
// (walk-in create + корекція), поведінка старих записів, відображення у картці
// й друкованому описі.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function bookingsList(db, cookie) {
  const res = await callWorker(new Request("http://localhost/api/staff/bookings", { headers:{ cookie } }), db);
  assert.equal(res.status, 200);
  return (await res.json()).bookings || [];
}

test("migration adds anatomical_regions + contrast_method with safe defaults and a contrast CHECK", async () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map((x) => x.trim()).filter(Boolean)) db.exec(s);
  }
  const cols = db.prepare("PRAGMA table_info(bookings)").all();
  const regions = cols.find((c) => c.name === "anatomical_regions");
  const contrast = cols.find((c) => c.name === "contrast_method");
  assert.ok(regions && contrast, "both columns exist");
  assert.equal(regions.dflt_value.replace(/'/g, ""), "", "regions default empty");
  assert.equal(contrast.dflt_value.replace(/'/g, ""), "", "contrast default empty (не вказано)");
  // старий запис без цих полів — дефолти застосовуються, нічого не ламається
  // розведені слоти, щоб не зачіпати тригер ємності (конфлікт того самого часу)
  db.prepare("INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id, duration_minutes, desired_date, desired_time) VALUES (1,'OLD-1','Старий','380971112233','380971112233','КТ','407','ct',30,'2020-01-01','09:00')").run();
  const old = db.prepare("SELECT anatomical_regions AS r, contrast_method AS c FROM bookings WHERE code='OLD-1'").get();
  assert.equal(old.r, "", "old record region stays unspecified");
  assert.equal(old.c, "", "old record contrast stays unspecified");
  // валідний контраст лягає, сміття відхиляє CHECK
  db.prepare("INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id, duration_minutes, desired_date, desired_time, contrast_method) VALUES (1,'OK-1','Ок','380971112234','380971112234','КТ','407','ct',30,'2020-01-02','09:00','iv')").run();
  assert.throws(() => db.prepare("INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id, duration_minutes, desired_date, desired_time, contrast_method) VALUES (1,'BAD-1','Бад','380971112235','380971112235','КТ','407','ct',30,'2020-01-03','09:00','zzz')").run(), /CHECK|constraint/i);
});

test("walk-in create persists sanitized regions (dedup, canonical order, drops unknown) + contrast", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"reg-sr@example.com", role:"registrar", organizationId:1 });
    const res = await callWorker(jsonRequest("/api/staff/protocols/studies", {
      name:"Пацієнт Р", phone:"+380501230011", serviceCode:"407",
      anatomicalRegions:["chest", "chest", "zzz", "head"], contrastMethod:"iv",
    }, { method:"POST", headers:{ cookie } }), db);
    assert.equal(res.status, 200);
    const { code } = await res.json();
    const row = (await bookingsList(db, cookie)).find((b) => b.code === code);
    assert.ok(row, "created booking present");
    // канонічний порядок head перед chest; дублі й невідомі відкинуті
    assert.equal(row.anatomicalRegions, "head,chest");
    assert.equal(row.contrastMethod, "iv");
  });
});

test("walk-in create without params leaves them explicitly unspecified; bogus contrast normalizes to empty", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"reg-sr2@example.com", role:"registrar", organizationId:1 });
    const bare = await callWorker(jsonRequest("/api/staff/protocols/studies", {
      name:"Без параметрів", phone:"+380501230012", serviceCode:"407",
    }, { method:"POST", headers:{ cookie } }), db);
    assert.equal(bare.status, 200);
    const bareCode = (await bare.json()).code;

    const bogus = await callWorker(jsonRequest("/api/staff/protocols/studies", {
      name:"Сміття контраст", phone:"+380501230013", serviceCode:"407",
      anatomicalRegions:"not_a_region", contrastMethod:"attack",
    }, { method:"POST", headers:{ cookie } }), db);
    assert.equal(bogus.status, 200);
    const bogusCode = (await bogus.json()).code;

    const list = await bookingsList(db, cookie);
    const bareRow = list.find((b) => b.code === bareCode);
    const bogusRow = list.find((b) => b.code === bogusCode);
    assert.equal(bareRow.anatomicalRegions, "");
    assert.equal(bareRow.contrastMethod, "");
    assert.equal(bogusRow.anatomicalRegions, "", "unknown region dropped → empty");
    assert.equal(bogusRow.contrastMethod, "", "bogus contrast → unspecified, not a fake value");
  });
});

test("correction (PATCH edit) updates region/contrast on a non-completed study; role-gated + audited", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"reg-sr3@example.com", role:"registrar", organizationId:1 });
    // напряму створюємо заплановану (не completed) заявку, щоб корекція була дозволена
    await db.prepare(
      "INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id, duration_minutes, desired_date, desired_time, status) VALUES (1,'SCHED-1','Запланований','380501230014','380501230014','КТ','407','ct',30,'2099-01-02','09:00','confirmed')"
    ).run();
    const id = Number((await db.prepare("SELECT id FROM bookings WHERE code='SCHED-1'").first()).id);
    const res = await callWorker(jsonRequest("/api/staff/bookings", {
      id, edit:{ anatomicalRegions:["abdomen", "pelvis"], contrastMethod:"oral" },
    }, { method:"PATCH", headers:{ cookie } }), db);
    assert.equal(res.status, 200);
    const row = (await bookingsList(db, cookie)).find((b) => b.code === "SCHED-1");
    assert.equal(row.anatomicalRegions, "abdomen,pelvis");
    assert.equal(row.contrastMethod, "oral");
    // радіолог не редагує параметри заявки: відмова (403 за роллю або 404 за
    // межею доступу до незакріпленої заявки) — головне, що не 200 і значення не змінилось
    const radiolog = await seedStaffSession(db, { email:"rad-sr@example.com", role:"radiologist", organizationId:1 });
    const denied = await callWorker(jsonRequest("/api/staff/bookings", {
      id, edit:{ contrastMethod:"iv" },
    }, { method:"PATCH", headers:{ cookie:radiolog } }), db);
    assert.ok([403, 404].includes(denied.status), `expected denial, got ${denied.status}`);
    const after = (await bookingsList(db, cookie)).find((b) => b.code === "SCHED-1");
    assert.equal(after.contrastMethod, "oral", "value unchanged after denied edit");
  });
});

test("taxonomy is single-sourced: protocols contrast field reuses study-attributes labels", async () => {
  const attrs = await read("lib/study-attributes.ts");
  assert.match(attrs, /CONTRAST_METHOD_LABELS/);
  assert.match(attrs, /"Без контрастування"/);
  const protocols = await read("lib/protocols.ts");
  assert.match(protocols, /import \{ CONTRAST_METHOD_LABELS \} from "\.\/study-attributes"/);
  assert.match(protocols, /\[\.\.\.CONTRAST_METHOD_LABELS\]/);
  // жодного повторного хардкоду опцій контрастування в протоколах
  assert.doesNotMatch(protocols, /\["Без контрастування", "Внутрішньовенне контрастування", "Пероральне контрастування"\]/);
});

test("fields flow through API and show in the study card + printed report", async () => {
  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /anatomical_regions AS anatomicalRegions, contrast_method AS contrastMethod/);
  const page = await read("app/staff/protocols/page.tsx");
  // картка (клінічний блок) + друк показують заповнені значення
  assert.ok((page.match(/regionLabels\(booking\.anatomicalRegions\)/g) || []).length >= 2, "regions shown in card + print");
  assert.ok((page.match(/contrastLabel\(sanitizeContrast\(booking\.contrastMethod\)\)/g) || []).length >= 2, "contrast shown in card + print");
  // форма створення (walk-in) має мультивибір ділянок + вибір контрасту
  assert.match(page, /ANATOMICAL_REGIONS\.map/);
  assert.match(page, /anatomicalRegions: nsRegions, contrastMethod: nsContrast/);
});

test("edit/create forms expose region multiselect + contrast on the intake board too", async () => {
  const intake = await read("app/staff/intake/page.tsx");
  assert.match(intake, /ANATOMICAL_REGIONS\.map/);
  assert.match(intake, /toggleRegion/);
  assert.match(intake, /anatomicalRegions:form\.regions, contrastMethod:form\.contrastMethod/);
});
