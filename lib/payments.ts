import {
  cleanupFinanceDocumentDraft,
  createFinanceDocumentDraft,
  financePostingStatements,
} from "./finance-documents.ts";

export type PaymentTransactionStatus = "pending" | "paid" | "failed" | "refunded" | "cancelled";

export interface PaymentBookingSnapshot {
  id:number;organizationId:number;code:string;patientId:string;paymentAmount:number;paymentStatus:string;
  paymentMethod:string;paidAmount:number;serviceCode:string;patientCategory:string;
}

export interface PaymentLedgerDb {
  prepare(sql:string):{bind(...values:unknown[]):{first<T=Record<string,unknown>>():Promise<T|null>;run():Promise<{meta:{changes?:number;last_row_id?:number|string}}>}};
  batch<T=unknown>(statements:T[]):Promise<unknown[]>;
}

function cleanCurrency(value:string){const currency=value.trim().toUpperCase();return /^[A-Z]{3}$/.test(currency)?currency:"UAH";}
function cleanProvider(value:string){return value.trim().toLowerCase().slice(0,40)||"manual";}
function cleanReference(value:string){return value.trim().slice(0,160);}

export async function paymentBookingSnapshot(db:PaymentLedgerDb,organizationId:number,bookingId:number):Promise<PaymentBookingSnapshot|null>{
  const row=await db.prepare(
    `SELECT id,organization_id AS organizationId,code,patient_id AS patientId,payment_amount AS paymentAmount,
            payment_status AS paymentStatus,payment_method AS paymentMethod,paid_amount AS paidAmount,
            service_code AS serviceCode,patient_category AS patientCategory
     FROM bookings WHERE organization_id=? AND id=? LIMIT 1`
  ).bind(organizationId,bookingId).first<PaymentBookingSnapshot>();
  return row||null;
}
function isFullyPaid(booking:PaymentBookingSnapshot){return booking.paymentStatus==="paid"&&booking.paymentAmount>0&&booking.paidAmount===booking.paymentAmount;}

export async function createPendingPayment(db:PaymentLedgerDb,input:{organizationId:number;bookingId:number;provider:string;currency?:string;providerReference?:string}){
  const booking=await paymentBookingSnapshot(db,input.organizationId,input.bookingId);if(!booking)throw new Error("booking_not_found");
  if(!Number.isInteger(booking.paymentAmount)||booking.paymentAmount<0)throw new Error("invalid_booking_amount");
  const provider=cleanProvider(input.provider);const currency=cleanCurrency(input.currency||"UAH");const providerReference=cleanReference(input.providerReference||"");
  if(providerReference){
    const existing=await db.prepare(
      `SELECT id,booking_id AS bookingId,amount,currency,provider,provider_reference AS providerReference,status,
              payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId,created_at AS createdAt,
              paid_at AS paidAt,refunded_at AS refundedAt
       FROM payment_transactions WHERE organization_id=? AND provider=? AND provider_reference=? LIMIT 1`
    ).bind(input.organizationId,provider,providerReference).first<Record<string,unknown>>();
    if(existing){
      if(Number(existing.bookingId)!==booking.id||Number(existing.amount)!==booking.paymentAmount)throw new Error("payment_reference_conflict");
      if(String(existing.status)==="paid"&&isFullyPaid(booking))throw new Error("payment_already_settled");
      return {transaction:existing,created:false,booking};
    }
  }
  if(isFullyPaid(booking))throw new Error("payment_already_settled");
  const result=await db.prepare(
    `INSERT INTO payment_transactions (organization_id,booking_id,amount,currency,provider,provider_reference,status)
     VALUES (?,?,?,?,?,?,'pending')`
  ).bind(input.organizationId,booking.id,booking.paymentAmount,currency,provider,providerReference).run();
  return {transaction:{id:Number(result.meta.last_row_id||0),bookingId:booking.id,amount:booking.paymentAmount,currency,provider,providerReference,status:"pending" as const,paymentDocumentId:null,refundDocumentId:null},created:true,booking};
}

type ExistingManualPayment={id:number;bookingId:number;amount:number;status:string;paymentDocumentId:number|null;refundDocumentId:number|null};
async function existingManualPayment(db:PaymentLedgerDb,organizationId:number,providerReference:string){
  return db.prepare(
    `SELECT id,booking_id AS bookingId,amount,status,payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId
     FROM payment_transactions WHERE organization_id=? AND provider='manual' AND provider_reference=? LIMIT 1`
  ).bind(organizationId,providerReference).first<ExistingManualPayment>();
}

export async function recordManualPayment(db:PaymentLedgerDb,input:{
  organizationId:number;bookingId:number;actor:string;method:string;providerReference?:string;cashAccountId?:number|null;
}){
  const booking=await paymentBookingSnapshot(db,input.organizationId,input.bookingId);if(!booking)throw new Error("booking_not_found");
  if(!Number.isInteger(booking.paymentAmount)||booking.paymentAmount<=0)throw new Error("invalid_booking_amount");
  const providerReference=cleanReference(input.providerReference||`manual:${booking.code}`);
  const existing=await existingManualPayment(db,input.organizationId,providerReference);
  if(existing){
    if(existing.bookingId!==booking.id||existing.amount!==booking.paymentAmount)throw new Error("payment_reference_conflict");
    if(existing.status==="refunded"||existing.refundDocumentId)throw new Error("payment_reference_conflict");
    if(existing.status==="paid"&&isFullyPaid(booking))return {id:existing.id,created:false,changed:false,booking,documentId:existing.paymentDocumentId||null,legacy:!existing.paymentDocumentId};
    if(existing.paymentDocumentId)throw new Error("payment_reference_conflict");
  }
  if(isFullyPaid(booking))throw new Error("payment_already_settled");

  const method=input.method.trim().slice(0,40)||"other";const financeDb=db as unknown as D1Database;
  const finance=await createFinanceDocumentDraft(financeDb,{
    organizationId:input.organizationId,bookingId:booking.id,actorEmail:input.actor,type:"payment",
    amount:booking.paymentAmount,currency:"UAH",method,provider:"manual",providerReference,
    cashAccountId:input.cashAccountId||null,comment:`Оплата за заявкою ${booking.code}`,
  });
  const nowExpr="CURRENT_TIMESTAMP";
  const statements:unknown[]=[
    ...financePostingStatements(financeDb,finance,input.actor),
    ...(existing?[db.prepare(
      `UPDATE payment_transactions SET status='paid',paid_at=${nowExpr},updated_at=${nowExpr},payment_document_id=?
       WHERE organization_id=? AND id=? AND payment_document_id IS NULL`
    ).bind(finance.document.id,input.organizationId,existing.id)]:[db.prepare(
      `INSERT INTO payment_transactions
       (organization_id,booking_id,amount,currency,provider,provider_reference,status,paid_at,payment_document_id)
       VALUES (?, ?, ?, 'UAH', 'manual', ?, 'paid', ${nowExpr}, ?)`
    ).bind(input.organizationId,booking.id,booking.paymentAmount,providerReference,finance.document.id)]),
    db.prepare(`UPDATE bookings SET payment_status='paid',paid_amount=payment_amount,payment_method=? WHERE organization_id=? AND id=?`)
      .bind(method,input.organizationId,booking.id),
    db.prepare(`INSERT INTO booking_events (organization_id,booking_id,action,details,actor) VALUES (?,?,'payment_confirmed',?,?)`)
      .bind(input.organizationId,booking.id,`manual · ${booking.paymentAmount} UAH · ${method} · document:${finance.document.number}`,input.actor),
  ];
  try{await db.batch(statements);}catch(error){
    await cleanupFinanceDocumentDraft(financeDb,input.organizationId,finance.document.id);
    const message=String(error).toLowerCase();
    if(message.includes("unique")){
      const race=await existingManualPayment(db,input.organizationId,providerReference);const refreshed=await paymentBookingSnapshot(db,input.organizationId,booking.id);
      if(race?.status==="paid"&&race.bookingId===booking.id&&race.amount===booking.paymentAmount&&refreshed&&isFullyPaid(refreshed))return {id:race.id,created:false,changed:false,booking:refreshed,documentId:race.paymentDocumentId||null,legacy:!race.paymentDocumentId};
      if(refreshed&&isFullyPaid(refreshed))throw new Error("payment_already_settled");
    }
    throw error;
  }
  const refreshed=await paymentBookingSnapshot(db,input.organizationId,booking.id)||booking;
  const transaction=await existingManualPayment(db,input.organizationId,providerReference);
  return {id:transaction?.id||existing?.id||0,created:!existing,changed:true,booking:refreshed,documentId:finance.document.id,legacy:false};
}

export async function latestPaymentForBooking(db:PaymentLedgerDb,organizationId:number,bookingId:number){
  return db.prepare(
    `SELECT id,amount,currency,provider,provider_reference AS providerReference,status,
            payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId,
            created_at AS createdAt,paid_at AS paidAt,refunded_at AS refundedAt
     FROM payment_transactions WHERE organization_id=? AND booking_id=? ORDER BY id DESC LIMIT 1`
  ).bind(organizationId,bookingId).first<Record<string,unknown>>();
}
