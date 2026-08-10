import assert from "node:assert/strict";
import test from "node:test";
import { createPendingPayment, latestPaymentForBooking, recordManualPayment } from "../lib/payments.ts";
import { withD1 } from "./helpers/d1.mjs";

async function seedBooking(db, { organizationId = 1, code, amount = 1500, status = "pending", desiredTime = "10:00" }) {
  const result = await db.prepare(
    `INSERT INTO bookings (
      organization_id, code, name, phone, phone_normalized, service, service_code,
      equipment_id, duration_minutes, desired_date, desired_time, patient_category,
      payment_status, payment_amount, paid_amount, status
    ) VALUES (?, ?, 'Пацієнт', '+380501112233', '380501112233', 'КТ ОГК', 'ct-chest',
      'ct', 30, '2026-08-20', ?, 'civilian', ?, ?, 0, 'confirmed')`,
  ).bind(organizationId, code, desiredTime, status, amount).run();
  return Number(result.meta.last_row_id);
}

test("pending payment amount is always derived from the booking snapshot", async () => {
  await withD1(async (db) => {
    const bookingId = await seedBooking(db, { code: "PAY-A", amount: 1700 });
    const result = await createPendingPayment(db, {
      organizationId: 1,
      bookingId,
      provider: "manual",
      providerReference: "ref-a",
    });
    assert.equal(result.transaction.amount, 1700);
    const row = await latestPaymentForBooking(db, 1, bookingId);
    assert.equal(row.amount, 1700);
    assert.equal(row.status, "pending");
  });
});

test("provider reference is idempotent and cannot be rebound to another booking", async () => {
  await withD1(async (db) => {
    const firstId = await seedBooking(db, { code: "PAY-B1", amount: 900, desiredTime: "10:00" });
    const secondId = await seedBooking(db, { code: "PAY-B2", amount: 900, desiredTime: "10:30" });
    const one = await createPendingPayment(db, {
      organizationId: 1,
      bookingId: firstId,
      provider: "liqpay",
      providerReference: "provider-42",
    });
    const again = await createPendingPayment(db, {
      organizationId: 1,
      bookingId: firstId,
      provider: "liqpay",
      providerReference: "provider-42",
    });
    assert.equal(one.created, true);
    assert.equal(again.created, false);
    await assert.rejects(
      () => createPendingPayment(db, {
        organizationId: 1,
        bookingId: secondId,
        provider: "liqpay",
        providerReference: "provider-42",
      }),
      /payment_reference_conflict/,
    );
    const count = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE organization_id = 1 AND provider_reference = 'provider-42'",
    ).first();
    assert.equal(count.n, 1);
  });
});

test("manual confirmation creates one paid ledger entry and updates booking aggregate", async () => {
  await withD1(async (db) => {
    const bookingId = await seedBooking(db, { code: "PAY-C", amount: 2100 });
    const first = await recordManualPayment(db, {
      organizationId: 1,
      bookingId,
      actor: "cashier@example.com",
      method: "bank_transfer",
      providerReference: "bank-receipt-100",
    });
    assert.equal(first.created, true);
    const booking = await db.prepare(
      "SELECT payment_status AS status, paid_amount AS paidAmount, payment_method AS method FROM bookings WHERE id = ?",
    ).bind(bookingId).first();
    assert.equal(booking.status, "paid");
    assert.equal(booking.paidAmount, 2100);
    assert.equal(booking.method, "bank_transfer");
    const payment = await latestPaymentForBooking(db, 1, bookingId);
    assert.equal(payment.status, "paid");
    assert.equal(payment.amount, 2100);
    assert.ok(payment.paidAt);

    const second = await recordManualPayment(db, {
      organizationId: 1,
      bookingId,
      actor: "cashier@example.com",
      method: "bank_transfer",
      providerReference: "bank-receipt-100",
    });
    assert.equal(second.created, false);
    const count = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE organization_id = ? AND booking_id = ?",
    ).bind(1, bookingId).first();
    assert.equal(count.n, 1);
  });
});

test("the same provider reference may exist independently in another tenant", async () => {
  await withD1(async (db) => {
    const one = await seedBooking(db, { organizationId: 1, code: "PAY-D1", amount: 1200 });
    const two = await seedBooking(db, { organizationId: 2, code: "PAY-D2", amount: 1300 });
    await createPendingPayment(db, {
      organizationId: 1,
      bookingId: one,
      provider: "manual",
      providerReference: "shared-ref",
    });
    await createPendingPayment(db, {
      organizationId: 2,
      bookingId: two,
      provider: "manual",
      providerReference: "shared-ref",
    });
    const count = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE provider_reference = 'shared-ref'",
    ).first();
    assert.equal(count.n, 2);
  });
});
