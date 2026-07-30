import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Міграція 0018 додає date_of_birth до bookings; вхід у кабінет — за
// збігом телефону і дати народження.
test("migration adds date_of_birth to bookings and phone+dob lookup works", async () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map((x) => x.trim()).filter(Boolean)) db.exec(s);
  }
  const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  assert.ok(cols.includes("date_of_birth"), "bookings.date_of_birth exists");
  db.prepare(
    "INSERT INTO bookings (code, name, phone, phone_normalized, date_of_birth, service, desired_date, desired_time) VALUES (?,?,?,?,?,?,?,?)"
  ).run("RD-TEST", "Іван", "+380971234567", "380971234567", "1990-05-21", "Рентген", "2026-08-01", "09:00");
  const proof = db.prepare(
    "SELECT id FROM bookings WHERE phone_normalized = ? AND date_of_birth = ? LIMIT 1"
  ).get("380971234567", "1990-05-21");
  assert.ok(proof, "phone + dob match a booking");
  const wrong = db.prepare(
    "SELECT id FROM bookings WHERE phone_normalized = ? AND date_of_birth = ? LIMIT 1"
  ).get("380971234567", "1990-05-22");
  assert.ok(!wrong, "wrong dob does not match");
});

// normalizeDob приймає лише правдоподібну YYYY-MM-DD.
test("normalizeDob validates the date shape and range", async () => {
  const src = await read("lib/dob.ts");
  assert.match(src, /\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$/);
  assert.match(src, /y < 1900 \|\| y > 2100/);
});

// Публічний запис (обидві форми) збирає й зберігає дату народження.
test("site-booking stores date_of_birth and requires it", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /normalizeDob\(body\.dob\)/);
  assert.match(route, /Вкажіть коректну дату народження/);
  assert.match(route, /date_of_birth/);
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /getElementById\('patientDob'\)/);
  assert.match(bridge, /getElementById\('militaryPatientDob'\)/);
  assert.match(bridge, /name, phone, dob,/); // dob потрапляє у payload
  for (const page of ["public/site/price.html", "public/site/military.html"]) {
    const html = await read(page);
    assert.match(html, /type="date"/, `${page} has a date input`);
  }
});

// Кабінет пацієнта: вхід за телефоном + датою народження (не за кодом).
test("patient cabinet logs in by phone and date of birth", async () => {
  const bookings = await read("app/api/my-bookings/route.ts");
  assert.match(bookings, /normalizeDob\(body\.dob\)/);
  assert.match(bookings, /phone_normalized = \? AND date_of_birth = \?/);
  assert.match(bookings, /дату народження/);
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /id="gateDob"/);
  assert.match(cabinet, /dob: dobValue/);
  assert.doesNotMatch(cabinet, /id="gateCode"/);
});
