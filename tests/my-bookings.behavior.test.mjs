// Поведінкові тести кабінету після OTP: /api/my-bookings не автентифікує
// знанням DOB/телефону, а лише читає вже підтверджену tenant + identity-scoped session.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedPatientSession } from "./helpers/d1.mjs";

const post = (db, cookie = "", opts = {}) => callWorker(
  jsonRequest("/api/my-bookings", undefined, {
    ...opts,
    headers: cookie ? { cookie, ...(opts.headers || {}) } : (opts.headers || {}),
  }),
  db,
);

async function seedBooking(db, over = {}) {
  const b = {
    code: "RD-AAAA1111", name: "Іваненко Іван", phone: "+380971112233", phoneNormalized: "380971112233",
    service: "КТ головного мозку", serviceCode: "CT-01", desiredDate: "2026-09-01", desiredTime: "10:00",
    status: "new", dob: "1990-05-05", category: "civilian", organizationId: 1, ...over,
  };
  await db.prepare(
    `INSERT INTO bookings (code, name, phone, phone_normalized, service, service_code,
       desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(b.code, b.name, b.phone, b.phoneNormalized, b.service, b.serviceCode,
    b.desiredDate, b.desiredTime, b.status, b.dob, b.category, b.organizationId).run();
  return b;
}

test("knowledge-only phone + DOB cannot establish cabinet access", async () => {
  await withD1(async (db) => {
    await seedBooking(db);
    const res = await callWorker(jsonRequest("/api/my-bookings", {
      phone: "+380971112233", dob: "1990-05-05",
    }), db);
    assert.equal(res.status, 401);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM patient_sessions").first("n"), 0);
  });
});

test("verified patient session returns only that patient's bookings", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { desiredTime: "10:00" });
    await seedBooking(db, {
      code: "RD-BBBB2222", name: "Петренко", phone: "+380975556677",
      phoneNormalized: "380975556677", dob: "1985-03-03", desiredTime: "10:30",
    });
    const cookie = await seedPatientSession(db, "380971112233", 1);
    const before = await db.prepare("SELECT COUNT(*) AS n FROM patient_sessions").first("n");
    const res = await post(db, cookie);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.bookings.length, 1);
    assert.equal(data.bookings[0].code, "RD-AAAA1111");
    const after = await db.prepare("SELECT COUNT(*) AS n FROM patient_sessions").first("n");
    assert.equal(after, before, "cabinet read must not mint another session");
  });
});

test("patient session is explicitly tenant-scoped", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2,'other','Інша',1)").run();
    await seedBooking(db, { code: "RD-OWN00001", organizationId: 1, desiredTime: "10:00" });
    await seedBooking(db, { code: "RD-OTHER001", organizationId: 2, desiredTime: "10:30" });
    const cookie = await seedPatientSession(db, "380971112233", 1);
    const res = await post(db, cookie);
    const data = await res.json();
    assert.deepEqual(data.bookings.map((b) => b.code), ["RD-OWN00001"]);
  });
});

test("expired or missing session is rejected", async () => {
  await withD1(async (db) => {
    assert.equal((await post(db)).status, 401);
    await seedBooking(db);
    const cookie = await seedPatientSession(db, "380971112233", 1);
    await db.prepare("UPDATE patient_sessions SET expires_at = datetime('now', '-1 minute')").run();
    assert.equal((await post(db, cookie)).status, 401);
  });
});

test("cabinet reads are rate-limited", async () => {
  await withD1(async (db) => {
    await seedBooking(db);
    const cookie = await seedPatientSession(db, "380971112233", 1);
    let last = 200;
    for (let i = 0; i < 22; i += 1) {
      last = (await post(db, cookie, { ip: "198.51.100.42" })).status;
    }
    assert.equal(last, 429);
  });
});
