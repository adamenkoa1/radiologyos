export type PaymentTransactionStatus = "pending" | "paid" | "failed" | "refunded" | "cancelled";

export interface PaymentBookingSnapshot {
  id: number;
  organizationId: number;
  code: string;
  paymentAmount: number;
  paymentStatus: string;
  paidAmount: number;
  serviceCode: string;
  patientCategory: string;
}

export interface PaymentLedgerDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<{ meta: { changes?: number; last_row_id?: number | string } }>;
    };
  };
  batch<T = unknown>(statements: T[]): Promise<unknown[]>;
}

function cleanCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "UAH";
}

function cleanProvider(value: string) {
  return value.trim().toLowerCase().slice(0, 40) || "manual";
}

function cleanReference(value: string) {
  return value.trim().slice(0, 160);
}

export async function paymentBookingSnapshot(
  db: PaymentLedgerDb,
  organizationId: number,
  bookingId: number,
): Promise<PaymentBookingSnapshot | null> {
  const row = await db.prepare(
    `SELECT id, organization_id AS organizationId, code,
      payment_amount AS paymentAmount, payment_status AS paymentStatus,
      paid_amount AS paidAmount, service_code AS serviceCode,
      patient_category AS patientCategory
     FROM bookings WHERE organization_id = ? AND id = ? LIMIT 1`,
  ).bind(organizationId, bookingId).first<PaymentBookingSnapshot>();
  return row || null;
}

export async function createPendingPayment(
  db: PaymentLedgerDb,
  input: {
    organizationId: number;
    bookingId: number;
    provider: string;
    currency?: string;
    providerReference?: string;
  },
) {
  const booking = await paymentBookingSnapshot(db, input.organizationId, input.bookingId);
  if (!booking) throw new Error("booking_not_found");
  if (!Number.isInteger(booking.paymentAmount) || booking.paymentAmount < 0) throw new Error("invalid_booking_amount");

  const provider = cleanProvider(input.provider);
  const currency = cleanCurrency(input.currency || "UAH");
  const providerReference = cleanReference(input.providerReference || "");

  if (providerReference) {
    const existing = await db.prepare(
      `SELECT id, booking_id AS bookingId, amount, currency, provider, provider_reference AS providerReference,
        status, created_at AS createdAt, paid_at AS paidAt, refunded_at AS refundedAt
       FROM payment_transactions
       WHERE organization_id = ? AND provider = ? AND provider_reference = ? LIMIT 1`,
    ).bind(input.organizationId, provider, providerReference).first<Record<string, unknown>>();
    if (existing) {
      if (Number(existing.bookingId) !== booking.id || Number(existing.amount) !== booking.paymentAmount) {
        throw new Error("payment_reference_conflict");
      }
      return { transaction: existing, created: false, booking };
    }
  }

  const result = await db.prepare(
    `INSERT INTO payment_transactions
      (organization_id, booking_id, amount, currency, provider, provider_reference, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  ).bind(
    input.organizationId,
    booking.id,
    booking.paymentAmount,
    currency,
    provider,
    providerReference,
  ).run();

  return {
    transaction: {
      id: Number(result.meta.last_row_id || 0),
      bookingId: booking.id,
      amount: booking.paymentAmount,
      currency,
      provider,
      providerReference,
      status: "pending" as const,
    },
    created: true,
    booking,
  };
}

export async function recordManualPayment(
  db: PaymentLedgerDb,
  input: {
    organizationId: number;
    bookingId: number;
    actor: string;
    method: string;
    providerReference?: string;
  },
) {
  const booking = await paymentBookingSnapshot(db, input.organizationId, input.bookingId);
  if (!booking) throw new Error("booking_not_found");
  if (!Number.isInteger(booking.paymentAmount) || booking.paymentAmount <= 0) throw new Error("invalid_booking_amount");

  const providerReference = cleanReference(input.providerReference || `manual:${booking.code}`);
  const existing = await db.prepare(
    `SELECT id, booking_id AS bookingId, amount, status
     FROM payment_transactions
     WHERE organization_id = ? AND provider = 'manual' AND provider_reference = ? LIMIT 1`,
  ).bind(input.organizationId, providerReference).first<{ id: number; bookingId: number; amount: number; status: string }>();

  if (existing) {
    if (existing.bookingId !== booking.id || existing.amount !== booking.paymentAmount) {
      throw new Error("payment_reference_conflict");
    }
    if (existing.status === "paid" && booking.paymentStatus === "paid" && booking.paidAmount === booking.paymentAmount) {
      return { id: existing.id, created: false, changed: false, booking };
    }
  }

  const method = input.method.trim().slice(0, 40) || "other";
  const nowExpr = "CURRENT_TIMESTAMP";
  const statements = existing
    ? [
        db.prepare(
          `UPDATE payment_transactions SET status = 'paid', paid_at = ${nowExpr}, updated_at = ${nowExpr}
           WHERE organization_id = ? AND id = ?`,
        ).bind(input.organizationId, existing.id),
        db.prepare(
          `UPDATE bookings SET payment_status = 'paid', paid_amount = payment_amount, payment_method = ?
           WHERE organization_id = ? AND id = ?`,
        ).bind(method, input.organizationId, booking.id),
        db.prepare(
          `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
           VALUES (?, ?, 'payment_confirmed', ?, ?)`,
        ).bind(input.organizationId, booking.id, `manual · ${booking.paymentAmount} UAH · ${method}`, input.actor),
      ]
    : [
        db.prepare(
          `INSERT INTO payment_transactions
            (organization_id, booking_id, amount, currency, provider, provider_reference, status, paid_at)
           VALUES (?, ?, ?, 'UAH', 'manual', ?, 'paid', ${nowExpr})`,
        ).bind(input.organizationId, booking.id, booking.paymentAmount, providerReference),
        db.prepare(
          `UPDATE bookings SET payment_status = 'paid', paid_amount = payment_amount, payment_method = ?
           WHERE organization_id = ? AND id = ?`,
        ).bind(method, input.organizationId, booking.id),
        db.prepare(
          `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
           VALUES (?, ?, 'payment_confirmed', ?, ?)`,
        ).bind(input.organizationId, booking.id, `manual · ${booking.paymentAmount} UAH · ${method}`, input.actor),
      ];

  await db.batch(statements);
  return { id: existing?.id || 0, created: !existing, changed: true, booking };
}

export async function latestPaymentForBooking(
  db: PaymentLedgerDb,
  organizationId: number,
  bookingId: number,
) {
  return db.prepare(
    `SELECT id, amount, currency, provider, provider_reference AS providerReference, status,
      created_at AS createdAt, paid_at AS paidAt, refunded_at AS refundedAt
     FROM payment_transactions
     WHERE organization_id = ? AND booking_id = ?
     ORDER BY id DESC LIMIT 1`,
  ).bind(organizationId, bookingId).first<Record<string, unknown>>();
}
