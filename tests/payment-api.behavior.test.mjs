import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedPatientSession, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function seedBooking(db, { code, phone = "380501112233", amount = 1500, organizationId = 1, desiredTime = "10:00" }) {
  const result = await db.prepare(
    `INSERT INTO bookings (
      organization_id, code, name, phone, phone_normalized, service, service_code,
      equipment_id, duration_minutes, desired_date, desired_time, patient_category,
      payment_status, payment_amount, paid_amount, status
    ) VALUES (?, ?, 'Пацієнт', '+380501112233', ?, 'КТ ОГК', 'ct-chest',
      'ct', 30, '2026-08-20', ?, 'civilian', 'pending', ?, 0, 'confirmed')`,
  ).bind(organizationId, code, phone, desiredTime, amount).run();
  return Number(result.meta.last_row_id);
}

async function addOrganizationTwo(db) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'payment-two', 'Payment Two', 1)",
  ).run();
}

async function setGlobal(db, key, value) {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(key, value).run();
}

test("patient payment start is session-scoped and server derives the amount", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { code: "RD-PAY-001", amount: 1800, desiredTime: "10:00" });
    await seedBooking(db, { code: "RD-PAY-002", phone: "380671112233", amount: 2200, desiredTime: "10:30" });
    const cookie = await seedPatientSession(db, "380501112233", 1);

    const own = await callWorker(jsonRequest("/api/pay-link", { code: "RD-PAY-001", amount: 1 }, {
      headers: { cookie },
    }), db);
    assert.equal(own.status, 200);
    const ownBody = await own.json();
    assert.equal(ownBody.booking.amount, 1800);
    assert.equal(ownBody.booking.code, "RD-PAY-001");
    assert.equal(ownBody.payment.amount, 1800);
    assert.equal(ownBody.payment.status, "pending");

    const foreign = await callWorker(jsonRequest("/api/pay-link", { code: "RD-PAY-002" }, {
      headers: { cookie },
    }), db);
    assert.equal(foreign.status, 404);
  });
});

test("secondary tenant payment start cannot use the primary global pay link or create a pending payment", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const phone = "380502224466";
    const code = "RD-PAY-ORG2";
    const bookingId = await seedBooking(db, {
      code,
      phone,
      amount: 2600,
      organizationId: 2,
      desiredTime: "11:00",
    });
    await setGlobal(db, "pay_link", "https://pay.example/org1-only");
    const cookie = await seedPatientSession(db, phone, 2, { kind: "booking", value: code });

    const response = await callWorker(jsonRequest("/api/pay-link", { code }, {
      headers: { cookie },
    }), db);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /не налаштована/i);
    assert.equal(JSON.stringify(body).includes("pay.example/org1-only"), false);

    const paymentCount = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE organization_id = 2 AND booking_id = ?",
    ).bind(bookingId).first();
    assert.equal(paymentCount.n, 0);

    const analyticsCount = await db.prepare(
      "SELECT COUNT(*) AS n FROM analytics_events WHERE organization_id = 2 AND event_name = 'payment_started'",
    ).first();
    assert.equal(analyticsCount.n, 0);
  });
});

test("staff reconciliation creates one booking-bound payment and is idempotent", async () => {
  await withD1(async (db) => {
    const bookingId = await seedBooking(db, { code: "RD-PAY-003", amount: 2400 });
    const cookie = await seedStaffSession(db, { email: "registrar@example.com", role: "registrar" });

    const request = () => jsonRequest("/api/staff/payments", {
      bookingId,
      method: "bank_transfer",
      providerReference: "receipt-003",
      amount: 1,
    }, { headers: { cookie } });

    const first = await callWorker(request(), db);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.paymentStatus, "paid");
    assert.equal(firstBody.paidAmount, 2400);
    assert.equal(firstBody.created, true);

    const second = await callWorker(request(), db);
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.created, false);

    const paymentCount = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE organization_id = 1 AND booking_id = ?",
    ).bind(bookingId).first();
    assert.equal(paymentCount.n, 1);

    const booking = await db.prepare(
      "SELECT payment_status AS status, payment_amount AS amount, paid_amount AS paid FROM bookings WHERE id = ?",
    ).bind(bookingId).first();
    assert.equal(booking.status, "paid");
    assert.equal(booking.amount, 2400);
    assert.equal(booking.paid, 2400);
  });
});

test("patient cabinet exposes latest ledger status without crossing tenant scope", async () => {
  await withD1(async (db) => {
    const bookingId = await seedBooking(db, { code: "RD-PAY-004", amount: 1300 });
    await db.prepare(
      `INSERT INTO payment_transactions
       (organization_id, booking_id, amount, currency, provider, provider_reference, status, paid_at)
       VALUES (1, ?, 1300, 'UAH', 'manual', 'receipt-004', 'paid', CURRENT_TIMESTAMP)`,
    ).bind(bookingId).run();
    await db.prepare(
      "UPDATE bookings SET payment_status = 'paid', paid_amount = 1300, payment_method = 'bank_transfer' WHERE id = ?",
    ).bind(bookingId).run();

    const cookie = await seedPatientSession(db, "380501112233", 1);
    const response = await callWorker(jsonRequest("/api/my-bookings", {}, {
      headers: { cookie },
    }), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.bookings[0].paymentStatus, "paid");
    assert.equal(body.bookings[0].paidAmount, 1300);
    assert.equal(body.bookings[0].paymentTransactionStatus, "paid");
    assert.equal(body.bookings[0].paymentReference, "receipt-004");
  });
});
