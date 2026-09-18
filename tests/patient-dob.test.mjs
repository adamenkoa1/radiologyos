import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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

test("normalizeDob validates the date shape and range", async () => {
  const { normalizeDob } = await import("../lib/dob.ts");
  assert.equal(normalizeDob("1990-05-21"), "1990-05-21");
  assert.equal(normalizeDob("2026-02-31"), "");
  assert.equal(normalizeDob("not-a-date"), "");
});

test("online booking accepts only adults aged 18 or older", async () => {
  const { isAdultDob } = await import("../lib/dob.ts");
  assert.equal(isAdultDob("2008-08-01", 18, "2026-08-01"), true);
  assert.equal(isAdultDob("2008-08-02", 18, "2026-08-01"), false);
});

test("site-booking stores date_of_birth and requires it", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /normalizeDob\(body\.dob\)/);
  assert.match(route, /isAdultDob\(dob\)/);
  assert.match(route, /Вкажіть коректну дату народження/);
  assert.match(route, /від 18 років/);
  assert.match(route, /date_of_birth/);
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /getElementById\('patientDob'\)/);
  assert.match(bridge, /getElementById\('militaryPatientDob'\)/);
  assert.match(bridge, /name, phone, dob,/);
  // Сегментований віджет винесено у спільний dob-widget.js (форма + кабінет).
  assert.match(bridge, /window\.enhanceDobSegments/);
  const dobWidget = await read("public/site/assets/dob-widget.js");
  assert.match(dobWidget, /dob-segmented/);
  assert.match(dobWidget, /День народження/);
  assert.match(dobWidget, /Місяць народження/);
  assert.match(dobWidget, /Рік народження/);
  assert.match(dobWidget, /Онлайн-запис доступний пацієнтам від 18 років/);
  assert.match(dobWidget, /window\.enhanceDobSegments = enhanceDobSegments/);
  for (const page of ["public/site/index.html", "public/site/price.html", "public/site/military.html"]) {
    const html = await read(page);
    assert.match(html, /id="(?:military)?[Pp]atientDob"[^>]*type="date"|id="patientDob"[^>]*type="date"/, `${page} has a date input`);
    assert.doesNotMatch(html, /max="2100-12-31"/, `${page} does not allow a future DOB`);
  }
});

test("public request is short and receives an automatic appointment", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /assignEarliestAppointments\(/);
  assert.match(route, /'new'/);
  assert.match(route, /прізвище, ім’я та по батькові/i);
  for (const page of ["public/site/index.html", "public/site/price.html", "public/site/military.html"]) {
    const html = await read(page);
    assert.match(html, /Прізвище, ім’я та по батькові/);
    assert.match(html, /Завантаження документів через сайт не виконується/);
    assert.doesNotMatch(html, /Або вкажіть дату вручну|Зручний час|<label for="(?:military)?[Rr]eferral">/);
    assert.doesNotMatch(html, /type="file"/);
  }
});

test("patient cabinet uses DOB only to request a possession OTP, then verifies six digits", async () => {
  const otp = await read("app/api/patient-otp/route.ts");
  assert.match(otp, /normalizeDob\(body\.dob\)/);
  assert.match(otp, /createPatientOtpChallenge/);
  assert.match(otp, /verifyPatientOtpChallenge/);
  assert.match(otp, /patientSessionCookie/);

  const bookings = await read("app/api/my-bookings/route.ts");
  assert.match(bookings, /requirePatientSession/);
  assert.doesNotMatch(bookings, /normalizeDob\(body\.dob\)/);
  assert.doesNotMatch(bookings, /createPatientSession/);

  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /id="gateDob"/);
  // Кабінет використовує той самий сегментований віджет дати, що й форма запису.
  assert.match(cabinet, /assets\/dob-widget\.js/);
  assert.match(cabinet, /enhanceDobSegments\(document\.getElementById\('gateDob'\)\)/);
  assert.match(cabinet, /\/api\/patient-otp/);
  assert.match(cabinet, /6.{0,20}(?:циф|знач)/i);
  assert.match(cabinet, /radiologyos_patient_prefill_v1/);
  assert.match(cabinet, /№ заявки:/);
  assert.match(cabinet, /statusMeta/);
});
