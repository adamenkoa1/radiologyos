// Поведінковий тест справжнього шляху ідентифікації пацієнта:
// /api/my-bookings проти живої SQLite-схеми (не перевірка рядків у коді).

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker } from "./helpers/d1.mjs";

const post = (db, body, opts) => callWorker(jsonRequest("/api/my-bookings", body, opts), db);

async function seedBooking(db, over = {}) {
  const b = {
    code: "RD-AAAA1111", name: "Іваненко Іван", phone: "+380971112233", phoneNormalized: "380971112233",
    service: "КТ головного мозку", serviceCode: "CT-01", desiredDate: "2026-09-01", desiredTime: "10:00",
    status: "new", dob: "1990-05-05", category: "civilian", ...over,
  };
  await db.prepare(
    `INSERT INTO bookings (code, name, phone, phone_normalized, service, service_code,
       desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`
  ).bind(b.code, b.name, b.phone, b.phoneNormalized, b.service, b.serviceCode,
    b.desiredDate, b.desiredTime, b.status, b.dob, b.category).run();
  return b;
}

test("correct phone + DOB returns the patient's bookings and opens a session", async () => {
  await withD1(async (db) => {
    await seedBooking(db);
    const res = await post(db, { phone: "+380971112233", dob: "1990-05-05" });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.bookings.length, 1);
    assert.equal(data.bookings[0].code, "RD-AAAA1111");
    // Сесію відкрито — cookie й реальний рядок у patient_sessions.
    assert.match(res.headers.get("set-cookie") || "", /rid_patient=/);
    const sessions = await db.prepare("SELECT COUNT(*) AS n FROM patient_sessions").first("n");
    assert.equal(sessions, 1);
  });
});

test("wrong DOB is rejected as unverified (identity proof actually enforced)", async () => {
  await withD1(async (db) => {
    await seedBooking(db);
    const res = await post(db, { phone: "+380971112233", dob: "1980-01-01" });
    assert.equal(res.status, 401);
    const sessions = await db.prepare("SELECT COUNT(*) AS n FROM patient_sessions").first("n");
    assert.equal(sessions, 0); // жодної сесії при невдалій перевірці
  });
});

test("a phone with no bookings cannot open a session", async () => {
  await withD1(async (db) => {
    const res = await post(db, { phone: "+380500000000", dob: "1990-05-05" });
    assert.equal(res.status, 401);
  });
});

test("malformed input is a 400 before any lookup", async () => {
  await withD1(async (db) => {
    const res = await post(db, { phone: "123", dob: "not-a-date" });
    assert.equal(res.status, 400);
  });
});

test("only bookings for the matching phone are returned (no cross-patient leak)", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { code: "RD-AAAA1111", phone: "+380971112233", phoneNormalized: "380971112233", dob: "1990-05-05", desiredTime: "10:00" });
    await seedBooking(db, { code: "RD-BBBB2222", name: "Петренко", phone: "+380975556677", phoneNormalized: "380975556677", dob: "1985-03-03", desiredTime: "10:30" });
    const res = await post(db, { phone: "+380971112233", dob: "1990-05-05" });
    const data = await res.json();
    assert.equal(data.bookings.length, 1);
    assert.equal(data.bookings[0].code, "RD-AAAA1111");
  });
});

test("brute force is rate-limited after the configured attempts", async () => {
  await withD1(async (db) => {
    let last = 200;
    for (let i = 0; i < 10; i += 1) {
      const res = await post(db, { phone: "+380509999999", dob: "1990-05-05" }, { ip: "198.51.100.42" });
      last = res.status;
    }
    assert.equal(last, 429); // ліміт 8/15хв — 9-та+ спроби відбиваються
  });
});
