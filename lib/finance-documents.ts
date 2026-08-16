export type FinanceDocumentType = "payment" | "refund";

export type FinanceDocumentRow = {
  id:number;
  organizationId:number;
  documentType:FinanceDocumentType;
  number:string;
  occurredAt:string;
  state:"draft"|"posted"|"reversed"|"cancelled";
  comment:string;
  createdBy:string;
  createdAt:string;
  postedBy:string;
  postedAt:string;
};

export type FinanceDocumentDetail = {
  organizationId:number;
  documentId:number;
  bookingId:number;
  patientId:string;
  amount:number;
  currency:string;
  method:string;
  provider:string;
  providerReference:string;
  sourceDocumentId:number|null;
  sourceTransactionId:number|null;
};

type FinanceTransactionRow = {
  id:number;
  status:string;
  provider:string;
  providerReference:string;
  paidAt:string;
  refundedAt:string;
};

export type FinanceDocument = {
  document:FinanceDocumentRow;
  detail:FinanceDocumentDetail;
  transaction:FinanceTransactionRow|null;
};

function clean(value:unknown,max:number) {
  return String(value ?? "").trim().slice(0,max);
}

function currency(value:unknown) {
  const result=clean(value,3).toUpperCase();
  return /^[A-Z]{3}$/.test(result) ? result : "UAH";
}

function amount(value:unknown) {
  const result=Number(value);
  return Number.isInteger(result) && result>0 ? result : null;
}

function positiveInt(value:unknown) {
  const result=Number(value);
  return Number.isInteger(result) && result>0 ? result : null;
}

function prefix(type:FinanceDocumentType) {
  return type === "payment" ? "ОП" : "ПВ";
}

export function isFinanceDocumentType(value:unknown): value is FinanceDocumentType {
  return value === "payment" || value === "refund";
}

export async function getFinanceDocument(
  db:D1Database,
  organizationId:number,
  documentId:number,
):Promise<FinanceDocument|null> {
  const row=await db.prepare(
    `SELECT d.id,d.organization_id AS organizationId,d.document_type AS documentType,d.number,
            d.occurred_at AS occurredAt,d.state,d.comment,d.created_by AS createdBy,d.created_at AS createdAt,
            d.posted_by AS postedBy,d.posted_at AS postedAt,
            f.booking_id AS bookingId,f.patient_id AS patientId,f.amount,f.currency,f.method,f.provider,
            f.provider_reference AS providerReference,f.source_document_id AS sourceDocumentId,
            f.source_transaction_id AS sourceTransactionId
     FROM business_documents d
     JOIN finance_document_details f ON f.document_id=d.id AND f.organization_id=d.organization_id
     WHERE d.organization_id=? AND d.id=? AND d.document_type IN ('payment','refund') LIMIT 1`
  ).bind(organizationId,documentId).first<FinanceDocumentRow & FinanceDocumentDetail>();
  if(!row) return null;
  const transaction=await db.prepare(
    `SELECT id,status,provider,provider_reference AS providerReference,paid_at AS paidAt,refunded_at AS refundedAt
     FROM payment_transactions
     WHERE organization_id=? AND (payment_document_id=? OR refund_document_id=?)
     ORDER BY id DESC LIMIT 1`
  ).bind(organizationId,documentId,documentId).first<FinanceTransactionRow>();
  return {
    document:{
      id:row.id,organizationId:row.organizationId,documentType:row.documentType,number:row.number,
      occurredAt:row.occurredAt,state:row.state,comment:row.comment,createdBy:row.createdBy,
      createdAt:row.createdAt,postedBy:row.postedBy,postedAt:row.postedAt,
    },
    detail:{
      organizationId:row.organizationId,documentId:row.id,bookingId:row.bookingId,patientId:row.patientId,
      amount:Number(row.amount),currency:row.currency,method:row.method,provider:row.provider,
      providerReference:row.providerReference,
      sourceDocumentId:row.sourceDocumentId == null ? null:Number(row.sourceDocumentId),
      sourceTransactionId:row.sourceTransactionId == null ? null:Number(row.sourceTransactionId),
    },
    transaction:transaction || null,
  };
}

export async function listFinanceDocuments(db:D1Database,organizationId:number,limit=200) {
  const safeLimit=Math.max(1,Math.min(500,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT d.id,d.document_type AS documentType,d.number,d.occurred_at AS occurredAt,d.state,
            d.created_by AS createdBy,d.posted_by AS postedBy,d.posted_at AS postedAt,
            f.booking_id AS bookingId,f.patient_id AS patientId,f.amount,f.currency,f.method,f.provider,
            f.provider_reference AS providerReference,f.source_document_id AS sourceDocumentId,
            f.source_transaction_id AS sourceTransactionId,
            b.code AS bookingCode,b.name AS patientName,b.service
     FROM business_documents d
     JOIN finance_document_details f ON f.document_id=d.id AND f.organization_id=d.organization_id
     JOIN bookings b ON b.id=f.booking_id AND b.organization_id=f.organization_id
     WHERE d.organization_id=? AND d.document_type IN ('payment','refund')
     ORDER BY d.occurred_at DESC,d.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}

export async function listCashMovements(db:D1Database,organizationId:number,limit=300) {
  const safeLimit=Math.max(1,Math.min(700,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT m.id,m.document_id AS documentId,d.number AS documentNumber,m.booking_id AS bookingId,
            b.code AS bookingCode,b.name AS patientName,m.movement_type AS movementType,
            m.amount_delta AS amountDelta,m.currency,m.method,m.provider,
            m.provider_reference AS providerReference,m.actor_email AS actorEmail,m.occurred_at AS occurredAt
     FROM cash_movements m
     JOIN business_documents d ON d.id=m.document_id AND d.organization_id=m.organization_id
     JOIN bookings b ON b.id=m.booking_id AND b.organization_id=m.organization_id
     WHERE m.organization_id=? ORDER BY m.occurred_at DESC,m.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}

export async function listPatientSettlementBalances(db:D1Database,organizationId:number,limit=300) {
  const safeLimit=Math.max(1,Math.min(700,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT m.booking_id AS bookingId,b.code AS bookingCode,b.name AS patientName,
            m.patient_id AS patientId,b.service,MAX(m.currency) AS currency,
            SUM(m.amount_delta) AS balance,MAX(m.occurred_at) AS lastMovementAt
     FROM patient_settlement_movements m
     JOIN bookings b ON b.id=m.booking_id AND b.organization_id=m.organization_id
     WHERE m.organization_id=?
     GROUP BY m.booking_id,b.code,b.name,m.patient_id,b.service
     ORDER BY lastMovementAt DESC,m.booking_id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}

export async function createFinanceDocumentDraft(
  db:D1Database,
  input:{
    organizationId:number;
    bookingId:number;
    actorEmail:string;
    type:FinanceDocumentType;
    amount:number;
    currency?:string;
    method?:string;
    provider?:string;
    providerReference?:string;
    sourceDocumentId?:number|null;
    sourceTransactionId?:number|null;
    comment?:string;
    occurredAt?:string;
  },
) {
  const validAmount=amount(input.amount);
  if(!validAmount) throw new Error("finance_document_invalid_amount");
  const booking=await db.prepare(
    `SELECT id,patient_id AS patientId FROM bookings WHERE organization_id=? AND id=? LIMIT 1`
  ).bind(input.organizationId,input.bookingId).first<{id:number;patientId:string}>();
  if(!booking) throw new Error("booking_not_found");

  const occurredAt=clean(input.occurredAt,32) || new Date().toISOString();
  const provider=clean(input.provider,40);
  const providerReference=clean(input.providerReference,160);
  const method=clean(input.method,40);
  const docCurrency=currency(input.currency || "UAH");
  const comment=clean(input.comment,500);
  const sourceDocumentId=positiveInt(input.sourceDocumentId);
  const sourceTransactionId=positiveInt(input.sourceTransactionId);

  if(input.type === "payment" && (sourceDocumentId || sourceTransactionId)) {
    throw new Error("finance_payment_cannot_have_source");
  }
  if(input.type === "refund" && !sourceTransactionId) {
    throw new Error("finance_refund_source_transaction_required");
  }

  const created=await db.prepare(
    `INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by)
     VALUES (?,?, '',?,'draft',?,?)`
  ).bind(input.organizationId,input.type,occurredAt,comment,input.actorEmail).run();
  const documentId=Number(created.meta.last_row_id || 0);
  if(!documentId) throw new Error("finance_document_create_failed");
  const number=`${prefix(input.type)}-${String(documentId).padStart(6,"0")}`;
  try {
    await db.prepare(
      "UPDATE business_documents SET number=? WHERE organization_id=? AND id=? AND state='draft'"
    ).bind(number,input.organizationId,documentId).run();
    await db.prepare(
      `INSERT INTO finance_document_details
        (organization_id,document_id,booking_id,patient_id,amount,currency,method,provider,provider_reference,source_document_id,source_transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      input.organizationId,documentId,input.bookingId,booking.patientId || "",validAmount,docCurrency,
      method,provider,providerReference,sourceDocumentId,sourceTransactionId,
    ).run();
  } catch(error) {
    await db.prepare("DELETE FROM finance_document_details WHERE organization_id=? AND document_id=?")
      .bind(input.organizationId,documentId).run().catch(()=>{});
    await db.prepare("DELETE FROM business_documents WHERE organization_id=? AND id=? AND state='draft'")
      .bind(input.organizationId,documentId).run().catch(()=>{});
    throw error;
  }
  const document=await getFinanceDocument(db,input.organizationId,documentId);
  if(!document) throw new Error("finance_document_create_failed");
  return document;
}

export async function cleanupFinanceDocumentDraft(db:D1Database,organizationId:number,documentId:number) {
  const row=await db.prepare(
    "SELECT state FROM business_documents WHERE organization_id=? AND id=? LIMIT 1"
  ).bind(organizationId,documentId).first<{state:string}>();
  if(!row || row.state !== "draft") return;
  await db.prepare("DELETE FROM finance_document_details WHERE organization_id=? AND document_id=?")
    .bind(organizationId,documentId).run().catch(()=>{});
  await db.prepare("DELETE FROM business_documents WHERE organization_id=? AND id=? AND state='draft'")
    .bind(organizationId,documentId).run().catch(()=>{});
}

export function financePostingStatements(
  db:D1Database,
  finance:FinanceDocument,
  actorEmail:string,
) {
  const type=finance.document.documentType;
  const cashDelta=type === "payment" ? finance.detail.amount : -finance.detail.amount;
  const settlementDelta=type === "payment" ? -finance.detail.amount : finance.detail.amount;
  const postedAt=new Date().toISOString();
  return [
    db.prepare(
      `UPDATE business_documents SET state='posted',posted_by=?,posted_at=?
       WHERE organization_id=? AND id=? AND state='draft'`
    ).bind(actorEmail,postedAt,finance.document.organizationId,finance.document.id),
    db.prepare(
      `INSERT INTO cash_movements
        (organization_id,document_id,booking_id,movement_type,amount_delta,currency,method,provider,provider_reference,actor_email,occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      finance.document.organizationId,finance.document.id,finance.detail.bookingId,type,cashDelta,
      finance.detail.currency,finance.detail.method,finance.detail.provider,finance.detail.providerReference,
      actorEmail,finance.document.occurredAt,
    ),
    db.prepare(
      `INSERT INTO patient_settlement_movements
        (organization_id,document_id,booking_id,patient_id,movement_type,amount_delta,currency,actor_email,occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      finance.document.organizationId,finance.document.id,finance.detail.bookingId,finance.detail.patientId,
      type,settlementDelta,finance.detail.currency,actorEmail,finance.document.occurredAt,
    ),
  ];
}
