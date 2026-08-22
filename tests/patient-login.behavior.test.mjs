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

test("cabinet login without SMS: phone + DOB + booking code opens a working session", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { code: "RD-260826-001" });

    // Missing the code is rejected.
    assert.equal((await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08" }), db)).status, 400);

    // Wrong code — no session.
    const wrong = await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08", bookingCode: "RD-000000-000" }), db);
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);

    // Wrong DOB with a real code — still rejected (all three must match one booking).
    assert.equal((await callWorker(loginRequest({ phone: "+380639982282", dob: "1980-01-01", bookingCode: "RD-260826-001" }), db)).status, 401);

    // All three correct — session cookie issued.
    const good = await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08", bookingCode: "RD-260826-001" }), db);
    assert.equal(good.status, 200);
    const cookie = good.headers.get("set-cookie") || "";
    assert.match(cookie, /rid_patient=/);

    // The session lists this patient's bookings.
    const raw = cookie.split(";")[0];
    const mine = await callWorker(
      new Request("http://localhost/api/my-bookings", { method: "POST", headers: { cookie: raw, "content-type": "application/json" }, body: "{}" }),
      db,
    );
    assert.equal(mine.status, 200);
    const data = await mine.json();
    assert.ok(Array.isArray(data.bookings));
    assert.ok(data.bookings.some((b) => b.code === "RD-260826-001"));
  });
});

test("with several records under one phone+DOB, login scopes to the exact code used (fail-closed)", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { code: "RD-260826-010", time: "09:00" });
    await seedBooking(db, { code: "RD-260826-011", time: "09:30" });

    const good = await callWorker(loginRequest({ phone: "+380639982282", dob: "1990-10-08", bookingCode: "RD-260826-010" }), db);
    assert.equal(good.status, 200);
    const raw = (good.headers.get("set-cookie") || "").split(";")[0];
    const mine = await callWorker(new Request("http://localhost/api/my-bookings", { method: "POST", headers: { cookie: raw, "content-type": "application/json" }, body: "{}" }), db);
    assert.equal(mine.status, 200);
    const data = await mine.json();
    const codes = (data.bookings || []).map((b) => b.code);
    // The session sees the booking it authenticated with, not the unrelated one.
    assert.deepEqual(codes, ["RD-260826-010"]);
  });
});
