import {
  cleanupFinanceDocumentDraft,
  createFinanceDocumentDraft,
  financePostingStatements,
} from "./finance-documents.ts";
import { paymentBookingSnapshot, type PaymentLedgerDb } from "./payments.ts";

type ProviderPaymentRow = {
  id:number;
  bookingId:number;
  amount:number;
  currency:string;
  provider:string;
  providerReference:string;
  status:string;
  paymentDocumentId:number|null;
  refundDocumentId:number|null;
};

async function providerPayment(
  db:PaymentLedgerDb,
  organizationId:number,
  provider:string,
  reference:string,
) {
  return db.prepare(
    `SELECT id,booking_id AS bookingId,amount,currency,provider,
            provider_reference AS providerReference,status,
            payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId
     FROM payment_transactions
     WHERE organization_id=? AND provider=? AND provider_reference=? LIMIT 1`,
  ).bind(organizationId,provider,reference).first<ProviderPaymentRow>();
}

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
  if (!provider || !reference || !/^[A-Z]{3}$/.test(currency)) throw new Error("invalid_provider_payment");

  const existing = await providerPayment(db,input.organizationId,provider,reference);
  if (existing && (existing.bookingId !== booking.id || existing.amount !== booking.paymentAmount)) {
    throw new Error("payment_reference_conflict");
  }
  if (existing?.status === "refunded" || existing?.refundDocumentId) {
    throw new Error("payment_reference_conflict");
  }
  if (existing?.status === "paid" && booking.paymentStatus === "paid" && booking.paidAmount === booking.paymentAmount) {
    return {
      id: existing.id,
      created: false,
      booking,
      documentId: existing.paymentDocumentId || null,
      legacy: !existing.paymentDocumentId,
    };
  }
  if (existing?.paymentDocumentId) throw new Error("payment_reference_conflict");
  if (booking.paymentStatus === "paid" && booking.paidAmount === booking.paymentAmount) {
    throw new Error("payment_already_settled");
  }

  const actor = (input.actor || `provider:${provider}`).slice(0, 254);
  const financeDb=db as unknown as D1Database;
  const finance=await createFinanceDocumentDraft(financeDb,{
    organizationId:input.organizationId,
    bookingId:booking.id,
    actorEmail:actor,
    type:"payment",
    amount:booking.paymentAmount,
    currency,
    method:provider,
    provider,
    providerReference:reference,
    comment:`Підтверджена оплата за заявкою ${booking.code}`,
  });

  const statements:unknown[]=[
    ...financePostingStatements(financeDb,finance,actor),
    ...(existing
      ? [db.prepare(
          `UPDATE payment_transactions
           SET status='paid',paid_at=CASE WHEN paid_at='' THEN CURRENT_TIMESTAMP ELSE paid_at END,
               updated_at=CURRENT_TIMESTAMP,payment_document_id=?
           WHERE organization_id=? AND id=? AND payment_document_id IS NULL`,
        ).bind(finance.document.id,input.organizationId,existing.id)]
      : [db.prepare(
          `INSERT INTO payment_transactions
           (organization_id,booking_id,amount,currency,provider,provider_reference,status,paid_at,payment_document_id)
           VALUES (?,?,?,?,?,?,'paid',CURRENT_TIMESTAMP,?)`,
        ).bind(
          input.organizationId,booking.id,booking.paymentAmount,currency,provider,reference,finance.document.id,
        )]),
    db.prepare(
      `UPDATE bookings SET payment_status='paid',paid_amount=payment_amount,payment_method=?
       WHERE organization_id=? AND id=?`,
    ).bind(provider,input.organizationId,booking.id),
    db.prepare(
      `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
       VALUES (?,?,'payment_confirmed',?,?)`,
    ).bind(
      input.organizationId,booking.id,
      `${provider} · ${booking.paymentAmount} ${currency} · document:${finance.document.number}`,
      actor,
    ),
  ];

  try {
    await db.batch(statements);
  } catch(error) {
    await cleanupFinanceDocumentDraft(financeDb,input.organizationId,finance.document.id);
    const message=String(error).toLowerCase();
    if(message.includes("unique")) {
      const race=await providerPayment(db,input.organizationId,provider,reference);
      const refreshed=await paymentBookingSnapshot(db,input.organizationId,booking.id);
      if(
        race?.status === "paid" && race.bookingId === booking.id && race.amount === booking.paymentAmount
        && refreshed?.paymentStatus === "paid" && refreshed.paidAmount === refreshed.paymentAmount
      ) {
        return {
          id:race.id,created:false,booking:refreshed,
          documentId:race.paymentDocumentId || null,legacy:!race.paymentDocumentId,
        };
      }
      if(refreshed?.paymentStatus === "paid" && refreshed.paidAmount === refreshed.paymentAmount) {
        throw new Error("payment_already_settled");
      }
    }
    throw error;
  }

  const transaction=await providerPayment(db,input.organizationId,provider,reference);
  const refreshed=await paymentBookingSnapshot(db,input.organizationId,booking.id) || booking;
  return {
    id:transaction?.id || existing?.id || 0,
    created:!existing,
    booking:refreshed,
    documentId:finance.document.id,
    legacy:false,
  };
}

export async function refundLatestPayment(
  db: PaymentLedgerDb,
  input: { organizationId: number; bookingId: number; actor: string },
) {
  const booking = await paymentBookingSnapshot(db, input.organizationId, input.bookingId);
  if (!booking) throw new Error("booking_not_found");
  const payment = await db.prepare(
    `SELECT id,amount,currency,provider,provider_reference AS providerReference,status,
            payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId
     FROM payment_transactions
     WHERE organization_id=? AND booking_id=? AND status IN ('paid','refunded')
     ORDER BY id DESC LIMIT 1`,
  ).bind(input.organizationId, booking.id).first<{
    id:number;amount:number;currency:string;provider:string;providerReference:string;status:string;
    paymentDocumentId:number|null;refundDocumentId:number|null;
  }>();
  if (!payment) throw new Error("paid_payment_not_found");
  if (payment.amount !== booking.paymentAmount) throw new Error("payment_amount_mismatch");
  if (payment.status === "refunded" && booking.paymentStatus === "refunded") {
    return {
      id:payment.id,
      changed:false,
      documentId:payment.refundDocumentId || null,
      legacy:!payment.refundDocumentId,
    };
  }
  if(payment.refundDocumentId) throw new Error("payment_reference_conflict");

  const financeDb=db as unknown as D1Database;
  const method=(booking.paymentMethod || payment.provider || "other").slice(0,40);
  const finance=await createFinanceDocumentDraft(financeDb,{
    organizationId:input.organizationId,
    bookingId:booking.id,
    actorEmail:input.actor,
    type:"refund",
    amount:booking.paymentAmount,
    currency:payment.currency || "UAH",
    method,
    provider:payment.provider,
    providerReference:payment.providerReference,
    sourceDocumentId:payment.paymentDocumentId || null,
    sourceTransactionId:payment.id,
    comment:`Повернення за заявкою ${booking.code}`,
  });

  try {
    await db.batch([
      ...financePostingStatements(financeDb,finance,input.actor),
      db.prepare(
        `UPDATE payment_transactions
         SET status='refunded',refunded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,refund_document_id=?
         WHERE organization_id=? AND id=? AND refund_document_id IS NULL`,
      ).bind(finance.document.id,input.organizationId,payment.id),
      db.prepare(
        `UPDATE bookings SET payment_status='refunded',paid_amount=0
         WHERE organization_id=? AND id=?`,
      ).bind(input.organizationId,booking.id),
      db.prepare(
        `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
         VALUES (?,?,'payment_refunded',?,?)`,
      ).bind(
        input.organizationId,booking.id,
        `${booking.paymentAmount} ${payment.currency || "UAH"} · document:${finance.document.number}`,
        input.actor,
      ),
    ]);
  } catch(error) {
    await cleanupFinanceDocumentDraft(financeDb,input.organizationId,finance.document.id);
    const current=await db.prepare(
      `SELECT status,refund_document_id AS refundDocumentId FROM payment_transactions
       WHERE organization_id=? AND id=? LIMIT 1`,
    ).bind(input.organizationId,payment.id).first<{status:string;refundDocumentId:number|null}>();
    const refreshed=await paymentBookingSnapshot(db,input.organizationId,booking.id);
    if(
      current?.status === "refunded" && refreshed?.paymentStatus === "refunded"
      && refreshed.paidAmount === 0
    ) {
      return {
        id:payment.id,changed:false,documentId:current.refundDocumentId || null,
        legacy:!current.refundDocumentId,
      };
    }
    throw error;
  }
  return { id: payment.id, changed: true, documentId:finance.document.id,legacy:false };
}
