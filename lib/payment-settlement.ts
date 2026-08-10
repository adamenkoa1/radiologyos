import { paymentBookingSnapshot, type PaymentLedgerDb } from "./payments.ts";

export async function settleVerifiedProviderPayment(
  db: PaymentLedgerDb,
  input: {
    organizationId: number;
    bookingId: number;
    provider: string;
    providerReference: string;
    amount: number;
    currency?: string;
    actor?: string;
  },
) {
  const booking = await paymentBookingSnapshot(db, input.organizationId, input.bookingId);
  if (!booking) throw new Error("booking_not_found");
  if (!Number.isInteger(input.amount) || input.amount !== booking.paymentAmount) throw new Error("payment_amount_mismatch");
  const provider = input.provider.trim().toLowerCase().slice(0, 40);
  const reference = input.providerReference.trim().slice(0, 160);
  const currency = (input.currency || "UAH").trim().toUpperCase().slice(0, 3);
  if (!provider || !reference) throw new Error("invalid_provider_payment");

  const existing = await db.prepare(
    `SELECT id, booking_id AS bookingId, amount, status
     FROM payment_transactions
     WHERE organization_id = ? AND provider = ? AND provider_reference = ? LIMIT 1`,
  ).bind(input.organizationId, provider, reference).first<{ id: number; bookingId: number; amount: number; status: string }>();
  if (existing && (existing.bookingId !== booking.id || existing.amount !== booking.paymentAmount)) {
    throw new Error("payment_reference_conflict");
  }
  if (existing?.status === "paid" && booking.paymentStatus === "paid" && booking.paidAmount === booking.paymentAmount) {
    return { id: existing.id, created: false, booking };
  }

  const actor = (input.actor || `provider:${provider}`).slice(0, 254);
  const statements = existing
    ? [
        db.prepare(
          `UPDATE payment_transactions
           SET status = 'paid', paid_at = CASE WHEN paid_at = '' THEN CURRENT_TIMESTAMP ELSE paid_at END,
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = ? AND id = ?`,
        ).bind(input.organizationId, existing.id),
      ]
    : [
        db.prepare(
          `INSERT INTO payment_transactions
           (organization_id, booking_id, amount, currency, provider, provider_reference, status, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, 'paid', CURRENT_TIMESTAMP)`,
        ).bind(input.organizationId, booking.id, booking.paymentAmount, currency, provider, reference),
      ];

  statements.push(
    db.prepare(
      `UPDATE bookings SET payment_status = 'paid', paid_amount = payment_amount, payment_method = ?
       WHERE organization_id = ? AND id = ?`,
    ).bind(provider, input.organizationId, booking.id),
    db.prepare(
      `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
       VALUES (?, ?, 'payment_confirmed', ?, ?)`,
    ).bind(input.organizationId, booking.id, `${provider} · ${booking.paymentAmount} ${currency}`, actor),
  );
  await db.batch(statements);
  return { id: existing?.id || 0, created: !existing, booking };
}

export async function refundLatestPayment(
  db: PaymentLedgerDb,
  input: { organizationId: number; bookingId: number; actor: string },
) {
  const booking = await paymentBookingSnapshot(db, input.organizationId, input.bookingId);
  if (!booking) throw new Error("booking_not_found");
  const payment = await db.prepare(
    `SELECT id, amount, status FROM payment_transactions
     WHERE organization_id = ? AND booking_id = ? AND status IN ('paid','refunded')
     ORDER BY id DESC LIMIT 1`,
  ).bind(input.organizationId, booking.id).first<{ id: number; amount: number; status: string }>();
  if (!payment) throw new Error("paid_payment_not_found");
  if (payment.amount !== booking.paymentAmount) throw new Error("payment_amount_mismatch");
  if (payment.status === "refunded" && booking.paymentStatus === "refunded") {
    return { id: payment.id, changed: false };
  }

  await db.batch([
    db.prepare(
      `UPDATE payment_transactions SET status = 'refunded', refunded_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND id = ?`,
    ).bind(input.organizationId, payment.id),
    db.prepare(
      `UPDATE bookings SET payment_status = 'refunded', paid_amount = 0
       WHERE organization_id = ? AND id = ?`,
    ).bind(input.organizationId, booking.id),
    db.prepare(
      `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
       VALUES (?, ?, 'payment_refunded', ?, ?)`,
    ).bind(input.organizationId, booking.id, `${booking.paymentAmount} UAH`, input.actor),
  ]);
  return { id: payment.id, changed: true };
}
