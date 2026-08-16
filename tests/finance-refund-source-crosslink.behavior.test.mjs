import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,code,amount) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status
     ) VALUES (1,?,'Crosslink Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-20','15:00','civilian','pending',?,0,'confirmed')`
  ).bind(code,amount).run();
  return Number(result.meta.last_row_id);
}

async function pay(db,cookie,bookingId,reference) {
  const response=await callWorker(jsonRequest("/api/staff/payments",{
    bookingId,method:"bank_transfer",providerReference:reference,
  },{headers:{cookie}}),db);
  assert.equal(response.status,200);
  return response.json();
}

test("refund source document must belong to the exact source payment transaction",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"crosslink@example.com",role:"registrar",organizationId:1});
    const bookingA=await seedBooking(db,"RD-CROSS-A",1400);
    const bookingB=await seedBooking(db,"RD-CROSS-B",1600);
    const paymentA=await pay(db,cookie,bookingA,"CROSS-PAY-A");
    const paymentB=await pay(db,cookie,bookingB,"CROSS-PAY-B");
    const txA=raw.prepare(
      `SELECT id,amount,currency,provider,provider_reference AS providerReference
       FROM payment_transactions WHERE organization_id=1 AND booking_id=? AND status='paid'`
    ).get(bookingA);

    const refund=raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,state,created_by)
       VALUES (1,'refund','CROSS-REFUND','draft','crosslink@example.com')`
    ).run();
    const refundId=Number(refund.lastInsertRowid);

    assert.throws(()=>raw.prepare(
      `INSERT INTO finance_document_details
       (organization_id,document_id,booking_id,amount,currency,method,provider,provider_reference,source_document_id,source_transaction_id)
       VALUES (1,?,?,?,'UAH','bank_transfer','manual','CROSS-PAY-A',?,?)`
    ).run(refundId,bookingA,txA.amount,paymentB.documentId,txA.id),/finance_refund_source_crosslink_invalid/);

    raw.prepare(
      `INSERT INTO finance_document_details
       (organization_id,document_id,booking_id,amount,currency,method,provider,provider_reference,source_document_id,source_transaction_id)
       VALUES (1,?,?,?,'UAH','bank_transfer','manual','CROSS-PAY-A',?,?)`
    ).run(refundId,bookingA,txA.amount,paymentA.documentId,txA.id);
    assert.equal(raw.prepare(
      "SELECT source_document_id AS sourceDocumentId,source_transaction_id AS sourceTransactionId FROM finance_document_details WHERE document_id=?"
    ).get(refundId).sourceDocumentId,paymentA.documentId);
  });
});
