import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-FIN-SEC",amount=2500,organizationId=1}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status
     ) VALUES (?,?,'Security Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-20','12:00','civilian','pending',?,0,'confirmed')`
  ).bind(organizationId,code,amount).run();
  return Number(result.meta.last_row_id);
}

async function pay(db,cookie,bookingId,reference) {
  return callWorker(jsonRequest("/api/staff/payments",{
    bookingId,method:"bank_transfer",providerReference:reference,
  },{headers:{cookie}}),db);
}

async function refund(db,cookie,bookingId) {
  return callWorker(new Request("http://localhost/api/staff/payments",{
    method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId}),
  }),db);
}

test("posted transaction registrar links cannot be nulled or swapped",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    const cookie=await seedStaffSession(db,{email:"finance-sec@example.com",role:"registrar",organizationId:1});
    const paid=await pay(db,cookie,bookingId,"SEC-PAY-1");
    assert.equal(paid.status,200);
    const payment=await paid.json();
    const returned=await refund(db,cookie,bookingId);
    assert.equal(returned.status,200);
    const refundBody=await returned.json();

    const transaction=raw.prepare(
      `SELECT id,payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId
       FROM payment_transactions WHERE organization_id=1 AND booking_id=?`
    ).get(bookingId);
    assert.equal(transaction.paymentDocumentId,payment.documentId);
    assert.equal(transaction.refundDocumentId,refundBody.documentId);

    assert.throws(
      ()=>raw.prepare("UPDATE payment_transactions SET payment_document_id=NULL WHERE id=?").run(transaction.id),
      /payment_document_link_immutable/,
    );
    assert.throws(
      ()=>raw.prepare("UPDATE payment_transactions SET refund_document_id=NULL WHERE id=?").run(transaction.id),
      /refund_document_link_immutable/,
    );
    assert.throws(
      ()=>raw.prepare("UPDATE payment_transactions SET payment_document_id=? WHERE id=?").run(refundBody.documentId,transaction.id),
      /payment_document_link_immutable/,
    );
  });
});

test("D1 rejects forged finance register movements that do not match the posted registrar",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-FIN-FORGE",amount:1900});
    const cookie=await seedStaffSession(db,{email:"finance-forge@example.com",role:"registrar",organizationId:1});
    const paid=await pay(db,cookie,bookingId,"SEC-PAY-2");
    const body=await paid.json();
    assert.equal(paid.status,200);

    assert.throws(()=>raw.prepare(
      `INSERT INTO cash_movements
       (organization_id,document_id,booking_id,movement_type,amount_delta,currency,method,provider,provider_reference,actor_email)
       VALUES (1,?,'${bookingId}','payment',1,'UAH','bank_transfer','manual','SEC-PAY-2','attacker@example.com')`
    ).run(body.documentId),/cash_movement_document_mismatch/);

    assert.throws(()=>raw.prepare(
      `INSERT INTO patient_settlement_movements
       (organization_id,document_id,booking_id,patient_id,movement_type,amount_delta,currency,actor_email)
       VALUES (1,?,?,'','payment',1900,'UAH','attacker@example.com')`
    ).run(body.documentId,bookingId),/patient_settlement_document_mismatch/);
  });
});

test("finance document details cannot cross tenant boundaries",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Finance Org 2','finance-org-2',1)");
    const org1Booking=await seedBooking(db,{code:"RD-FIN-TENANT-1",amount:1200,organizationId:1});
    const org2Booking=await seedBooking(db,{code:"RD-FIN-TENANT-2",amount:1200,organizationId:2});
    const created=raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,state,created_by)
       VALUES (1,'payment','SEC-DRAFT','draft','admin@example.com')`
    ).run();
    const documentId=Number(created.lastInsertRowid);

    assert.throws(()=>raw.prepare(
      `INSERT INTO finance_document_details
       (organization_id,document_id,booking_id,amount,currency,method,provider,provider_reference)
       VALUES (1,?,?,1200,'UAH','cash','manual','CROSS')`
    ).run(documentId,org2Booking),/finance_booking_tenant_mismatch/);

    raw.prepare(
      `INSERT INTO finance_document_details
       (organization_id,document_id,booking_id,amount,currency,method,provider,provider_reference)
       VALUES (1,?,?,1200,'UAH','cash','manual','LOCAL')`
    ).run(documentId,org1Booking);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM finance_document_details WHERE document_id=?").get(documentId).n,1);
  });
});
