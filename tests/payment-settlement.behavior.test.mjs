import assert from "node:assert/strict";
import test from "node:test";
import { createPendingPayment } from "../lib/payments.ts";
import { refundLatestPayment, settleVerifiedProviderPayment } from "../lib/payment-settlement.ts";
import { withD1 } from "./helpers/d1.mjs";

async function seedBooking(db, { code, amount = 1500 }) {
  const result = await db.prepare(
    `INSERT INTO bookings (
      organization_id, code, name, phone, phone_normalized, service, service_code,
      equipment_id, duration_minutes, desired_date, desired_time, patient_category,
      payment_status, payment_amount, paid_amount, status
    ) VALUES (1, ?, 'Пацієнт', '+380501112233', '380501112233', 'КТ ОГК', 'ct-chest',
      'ct', 30, '2026-08-20', '11:00', 'civilian', 'pending', ?, 0, 'confirmed')`,
  ).bind(code, amount).run();
  return Number(result.meta.last_row_id);
}

test("verified provider settlement is replay-safe and cannot alter authoritative amount", async () => {
  await withD1(async (db) => {
    const bookingId = await seedBooking(db, { code: "SETTLE-1", amount: 1900 });
    await createPendingPayment(db, {
      organizationId: 1,
      bookingId,
      provider: "liqpay",
      providerReference: "lp-100",
    });

    await assert.rejects(
      () => settleVerifiedProviderPayment(db, {
        organizationId: 1,
        bookingId,
        provider: "liqpay",
        providerReference: "lp-100",
        amount: 1,
      }),
      /payment_amount_mismatch/,
    );

    const first = await settleVerifiedProviderPayment(db, {
      organizationId: 1,
      bookingId,
      provider: "liqpay",
      providerReference: "lp-100",
      amount: 1900,
    });
    assert.equal(first.created, false);
    const second = await settleVerifiedProviderPayment(db, {
      organizationId: 1,
      bookingId,
      provider: "liqpay",
      providerReference: "lp-100",
      amount: 1900,
    });
    assert.equal(second.created, false);

    const count = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE provider = 'liqpay' AND provider_reference = 'lp-100'",
    ).first();
    assert.equal(count.n, 1);
    const booking = await db.prepare(
      "SELECT payment_status AS status, paid_amount AS paid FROM bookings WHERE id = ?",
    ).bind(bookingId).first();
    assert.equal(booking.status, "paid");
    assert.equal(booking.paid, 1900);
  });
});

test("refund is audited and idempotent", async () => {
  await withD1(async (db) => {
    const bookingId = await seedBooking(db, { code: "REFUND-1", amount: 1100 });
    await settleVerifiedProviderPayment(db, {
      organizationId: 1,
      bookingId,
      provider: "liqpay",
      providerReference: "lp-refund",
      amount: 1100,
    });

    const first = await refundLatestPayment(db, {
      organizationId: 1,
      bookingId,
      actor: "registrar@example.com",
    });
    assert.equal(first.changed, true);
    const second = await refundLatestPayment(db, {
      organizationId: 1,
      bookingId,
      actor: "registrar@example.com",
    });
    assert.equal(second.changed, false);

    const transaction = await db.prepare(
      "SELECT status, refunded_at AS refundedAt FROM payment_transactions WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
    ).bind(bookingId).first();
    assert.equal(transaction.status, "refunded");
    assert.ok(transaction.refundedAt);
    const booking = await db.prepare(
      "SELECT payment_status AS status, paid_amount AS paid FROM bookings WHERE id = ?",
    ).bind(bookingId).first();
    assert.equal(booking.status, "refunded");
    assert.equal(booking.paid, 0);
    const audit = await db.prepare(
      "SELECT COUNT(*) AS n FROM booking_events WHERE booking_id = ? AND action = 'payment_refunded'",
    ).bind(bookingId).first();
    assert.equal(audit.n, 1);
  });
});
