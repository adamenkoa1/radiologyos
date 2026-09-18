import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker } from "./helpers/d1.mjs";

async function seedBooking(db, { code, phone = "380639982282", dob = "1990-10-08", time = "11:00" }) {
  await db.prepare(
    `INSERT INTO bookings (
      organization_id, code, name, phone, phone_normalized, date_of_birth, service, service_code,
      equipment_id, duration_minutes, desired_date, desired_time, patient_category,
      payment_status, payment_amount, paid_amount, status
    ) VALUES (1, ?, 'Пацієнт', ?, ?, ?, 'Цифрова рентгенографія', '201',
      'xray', 15, '2026-08-26', ?, 'civilian', 'pending', 500, 0, 'new')`,
  ).bind(code, `+${phone}`, phone, dob, time).run();
}

function loginRequest(body) {
  return new Request("http://localhost/api/patient-login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20" },
    body: JSON.stringify(body),
  });
}

const myBookings = (raw) => new Request("http://localhost/api/my-bookings", {
  method: "POST", headers: { cookie: raw, "content-type": "application/json" }, body: "{}",
});

test("phone + DOB alone opens a session for a single record; booking code still works", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { code: "RD-260826-001" });

    // Phone or DOB missing → rejected.
    assert.equal((await callWorker(loginRequest({ phone: "+380639982282" }), db)).status, 400);

    // Phone + DOB alone, one matching record → session cookie issued (no code needed).
    const dobOnly = await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08" }), db);
    assert.equal(dobOnly.status, 200);
    const rawDob = (dobOnly.headers.get("set-cookie") || "").split(";")[0];
    assert.match(rawDob, /rid_patient=/);
    const mineDob = await callWorker(myBookings(rawDob), db);
    assert.equal(mineDob.status, 200);
    assert.ok((await mineDob.json()).bookings.some((b) => b.code === "RD-260826-001"));

    // Wrong DOB → rejected, no session.
    const wrongDob = await callWorker(loginRequest({ phone: "+380639982282", dob: "1980-01-01" }), db);
    assert.equal(wrongDob.status, 401);
    assert.equal(wrongDob.headers.get("set-cookie"), null);

    // Booking-code path still works: wrong code rejected, correct code accepted.
    assert.equal((await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08", bookingCode: "RD-000000-000" }), db)).status, 401);
    const good = await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08", bookingCode: "RD-260826-001" }), db);
    assert.equal(good.status, 200);
    assert.match(good.headers.get("set-cookie") || "", /rid_patient=/);
  });
});

test("several records under one phone+DOB: phone+DOB alone is fail-closed (409 + needBookingCode); the exact code scopes in", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { code: "RD-260826-010", time: "09:00" });
    await seedBooking(db, { code: "RD-260826-011", time: "09:30" });

    // Without a code, phone+DOB maps to several records → fail-closed, no session.
    const amb = await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08" }), db);
    assert.equal(amb.status, 409);
    assert.equal(amb.headers.get("set-cookie"), null);
    assert.equal((await amb.json()).needBookingCode, true);

    // The exact booking code scopes the session to that one record.
    const good = await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08", bookingCode: "RD-260826-010" }), db);
    assert.equal(good.status, 200);
    const raw = (good.headers.get("set-cookie") || "").split(";")[0];
    const mine = await callWorker(myBookings(raw), db);
    assert.equal(mine.status, 200);
    const codes = (await mine.json()).bookings.map((b) => b.code);
    // The session sees the booking it authenticated with, not the unrelated one.
    assert.deepEqual(codes, ["RD-260826-010"]);
  });
});
