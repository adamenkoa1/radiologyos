// Поведінкові тести підтвердження й перенесення заявки персоналом проти живої
// схеми: зміна статусу, журнал подій, запуск авто-нагадування, перевірки слота.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

// Майбутній робочий день (не неділя) у межах вікна бронювання.
function futureWeekday(daysAhead = 7) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function seedBooking(db, { id = 1, date, time = "10:00", status = "new", equipmentId = "xray" }) {
  await db.prepare(
    `INSERT INTO bookings (id, code, name, phone, phone_normalized, patient_email, service, service_code,
       equipment_id, duration_minutes, desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
  ).bind(id, `RD-CR${String(id).padStart(6, "0")}`, "Пацієнт", "+380971112233", "380971112233", "",
    "Цифрова рентгенографія", "201", equipmentId, 15, date, time, status, "1990-05-05", "civilian").run();
}

const patch = (db, cookie, body) =>
  callWorker(jsonRequest("/api/staff/bookings", body, { method: "PATCH", headers: { cookie } }), db);

test("confirming a booking sets status, logs the event and runs the reminder pipeline", async () => {
  await withD1(async (db) => {
    const date = futureWeekday();
    await seedBooking(db, { id: 1, date, time: "10:00", status: "new" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await patch(db, cookie, { id: 1, confirm: true });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "confirmed");
    // Нагадування спрацювало (шлюзи не налаштовані → нічого не надіслано, але pipeline пройшов).
    assert.ok(data.reminder, "reminder summary присутній");
    assert.equal(data.reminder.sent, 0);

    const st = await db.prepare("SELECT status FROM bookings WHERE id = 1").first("status");
    assert.equal(st, "confirmed");
    const ev = await db.prepare("SELECT COUNT(*) AS n FROM booking_events WHERE booking_id = 1 AND details = 'confirmed'").first("n");
    assert.equal(ev, 1);
  });
});

test("confirming a booking whose time is outside the schedule is refused", async () => {
  await withD1(async (db) => {
    const date = futureWeekday();
    await seedBooking(db, { id: 2, date, time: "07:00", status: "new" }); // до відкриття рентгену (10:00)
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await patch(db, cookie, { id: 2, confirm: true });
    assert.equal(res.status, 400); // просить перенести
    const st = await db.prepare("SELECT status FROM bookings WHERE id = 2").first("status");
    assert.equal(st, "new"); // статус не змінено
  });
});

test("a cancelled booking cannot be confirmed", async () => {
  await withD1(async (db) => {
    const date = futureWeekday();
    await seedBooking(db, { id: 3, date, time: "10:00", status: "cancelled" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await patch(db, cookie, { id: 3, confirm: true });
    assert.equal(res.status, 400);
  });
});

test("rescheduling moves the slot, marks rescheduled and runs the reminder", async () => {
  await withD1(async (db) => {
    const date = futureWeekday();
    await seedBooking(db, { id: 4, date, time: "10:00", status: "new" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await patch(db, cookie, { id: 4, desiredDate: date, desiredTime: "11:00" });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "rescheduled");
    assert.ok(data.reminder);
    const row = await db.prepare("SELECT status, desired_time AS t FROM bookings WHERE id = 4").first();
    assert.equal(row.status, "rescheduled");
    assert.equal(row.t, "11:00");
  });
});

test("rescheduling onto an occupied slot is rejected as a conflict", async () => {
  await withD1(async (db) => {
    const date = futureWeekday();
    await seedBooking(db, { id: 5, date, time: "10:00", status: "new" });          // яку переносимо
    await seedBooking(db, { id: 6, date, time: "11:00", status: "confirmed" });     // зайнятий слот
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await patch(db, cookie, { id: 5, desiredDate: date, desiredTime: "11:00" });
    assert.equal(res.status, 409);
    const t = await db.prepare("SELECT desired_time AS t FROM bookings WHERE id = 5").first("t");
    assert.equal(t, "10:00"); // лишилась на місці
  });
});
