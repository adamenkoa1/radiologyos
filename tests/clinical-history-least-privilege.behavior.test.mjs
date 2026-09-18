import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

async function seedBooking(db, { id, radiologist, radiographer }) {
  await db.prepare(
    `INSERT INTO bookings (
      id, organization_id, code, name, phone, phone_normalized, patient_email,
      service, service_code, equipment_id, duration_minutes, desired_date, desired_time,
      status, date_of_birth, patient_category,
      assigned_radiologist_email, assigned_radiographer_email,
      payment_status, payment_amount, paid_amount, payment_method, nszu_status, nszu_reference
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, 1, `RD-PRIV${id}`, "Least Privilege Patient", "+380971119999", "380971119999",
    "secret.patient@example.test", "КТ", "CT-01", "ct", 30, "2026-09-03", "12:00",
    "confirmed", "1990-01-01", "civilian", radiologist, radiographer,
    "paid", 1500, 1500, "cash", "confirmed", "NSZU-SECRET-001",
  ).run();

  const events = [
    ["status_changed", "confirmed"],
    ["payment_confirmed", "manual · 1500 UAH · cash"],
    ["payment_refunded", "1500 UAH"],
    ["finance_updated", "paid · paid=1500 грн · confirmed"],
  ];
  for (const [action, details] of events) {
    await db.prepare(
      `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
       VALUES (1, ?, ?, ?, 'finance@test')`,
    ).bind(id, action, details).run();
  }

  await db.prepare(
    `INSERT INTO patient_notifications
      (organization_id, booking_id, kind, channel, recipient, body, status, error, sent_at)
     VALUES (1, ?, 'custom', 'email', 'secret.patient@example.test', 'Service message', 'sent', '', CURRENT_TIMESTAMP)`,
  ).bind(id).run();
}

const getContext = (db, cookie, id) => callWorker(
  jsonRequest(`/api/staff/study-context?id=${id}`, undefined, { method:"GET", headers:{ cookie } }), db,
);
const getBookings = (db, cookie) => callWorker(
  jsonRequest("/api/staff/bookings", undefined, { method:"GET", headers:{ cookie } }), db,
);

function actions(data) {
  return (data.events || []).map((event) => event.action).sort();
}

for (const roleCase of [
  { role:"radiologist", email:"privacy-rad@likarnya.test", assignment:"radiologist" },
  { role:"radiographer", email:"privacy-tech@likarnya.test", assignment:"radiographer" },
]) {
  test(`${roleCase.role} does not receive finance history or notification recipient`, async () => {
    await withD1(async (db) => {
      const radiologist = roleCase.assignment === "radiologist" ? roleCase.email : "other-rad@likarnya.test";
      const radiographer = roleCase.assignment === "radiographer" ? roleCase.email : "other-tech@likarnya.test";
      const id = roleCase.role === "radiologist" ? 921 : 922;
      await seedBooking(db, { id, radiologist, radiographer });
      const cookie = await seedStaffSession(db, { email:roleCase.email, role:roleCase.role });

      const contextResponse = await getContext(db, cookie, id);
      assert.equal(contextResponse.status, 200);
      const context = await contextResponse.json();
      assert.deepEqual(actions(context), ["status_changed"]);
      assert.doesNotMatch(JSON.stringify(context.events), /1500|cash|NSZU-SECRET/);

      const bookingsResponse = await getBookings(db, cookie);
      assert.equal(bookingsResponse.status, 200);
      const bulk = await bookingsResponse.json();
      assert.deepEqual(actions(bulk), ["status_changed"]);
      assert.equal(bulk.notifications.length, 1);
      assert.equal(Object.hasOwn(bulk.notifications[0], "recipient"), false);
      assert.doesNotMatch(JSON.stringify(bulk.events), /1500|cash|NSZU-SECRET/);
    });
  });
}

test("registrar retains finance history and notification recipient", async () => {
  await withD1(async (db) => {
    const id = 923;
    await seedBooking(db, { id, radiologist:"rad@likarnya.test", radiographer:"tech@likarnya.test" });
    const cookie = await seedStaffSession(db, { email:"privacy-reg@likarnya.test", role:"registrar" });

    const contextResponse = await getContext(db, cookie, id);
    assert.equal(contextResponse.status, 200);
    const context = await contextResponse.json();
    assert.deepEqual(actions(context), ["finance_updated", "payment_confirmed", "payment_refunded", "status_changed"]);
    assert.match(JSON.stringify(context.events), /1500/);

    const bookingsResponse = await getBookings(db, cookie);
    assert.equal(bookingsResponse.status, 200);
    const bulk = await bookingsResponse.json();
    assert.deepEqual(actions(bulk), ["finance_updated", "payment_confirmed", "payment_refunded", "status_changed"]);
    assert.equal(bulk.notifications.length, 1);
    assert.equal(bulk.notifications[0].recipient, "secret.patient@example.test");
  });
});
