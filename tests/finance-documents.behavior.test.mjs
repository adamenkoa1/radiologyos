import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedPatientSession, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-FIN-001",amount=2400,phone="380501112233",organizationId=1}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status
     ) VALUES (?,?,'Пацієнт Фінанси','+380501112233',?,'КТ ОГК','ct-chest','ct',30,
       '2026-08-20','10:00','civilian','pending',?,0,'confirmed')`
  ).bind(organizationId,code,phone,amount).run();
  return Number(result.meta.last_row_id);
}

async function pay(db,cookie,bookingId,reference="FIN-REF-001") {
  return callWorker(jsonRequest("/api/staff/payments",{
    bookingId,method:"bank_transfer",providerReference:reference,
  },{headers:{cookie}}),db);
}

async function refund(db,cookie,bookingId) {
  return callWorker(new Request("http://localhost/api/staff/payments",{
    method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId}),
  }),db);
}

test("confirmed manual payment posts one BAS document and exact cash/settlement movements",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    const cookie=await seedStaffSession(db,{email:"finance@example.com",role:"registrar",organizationId:1});

    const first=await pay(db,cookie,bookingId);
    assert.equal(first.status,200);
    const firstBody=await first.json();
    assert.equal(firstBody.paymentStatus,"paid");
    assert.equal(firstBody.paidAmount,2400);
    assert.equal(firstBody.legacy,false);
    assert.ok(Number.isInteger(firstBody.documentId)&&firstBody.documentId>0);

    const second=await pay(db,cookie,bookingId);
    assert.equal(second.status,200);
    const secondBody=await second.json();
    assert.equal(secondBody.created,false);
    assert.equal(secondBody.documentId,firstBody.documentId);

    const document=raw.prepare(
      `SELECT document_type,state,number FROM business_documents WHERE organization_id=1 AND id=?`
    ).get(firstBody.documentId);
    assert.equal(document.document_type,"payment");
    assert.equal(document.state,"posted");
    assert.match(document.number,/^ОП-\d{6}$/);

    const detail=raw.prepare(
      `SELECT booking_id,amount,currency,method,provider,provider_reference
       FROM finance_document_details WHERE organization_id=1 AND document_id=?`
    ).get(firstBody.documentId);
    assert.equal(detail.booking_id,bookingId);
    assert.equal(detail.amount,2400);
    assert.equal(detail.currency,"UAH");
    assert.equal(detail.method,"bank_transfer");
    assert.equal(detail.provider,"manual");
    assert.equal(detail.provider_reference,"FIN-REF-001");

    const cash=raw.prepare(
      `SELECT COUNT(*) AS n,SUM(amount_delta) AS amount FROM cash_movements
       WHERE organization_id=1 AND document_id=?`
    ).get(firstBody.documentId);
    assert.equal(cash.n,1);
    assert.equal(cash.amount,2400);

    const settlement=raw.prepare(
      `SELECT COUNT(*) AS n,SUM(amount_delta) AS amount FROM patient_settlement_movements
       WHERE organization_id=1 AND document_id=?`
    ).get(firstBody.documentId);
    assert.equal(settlement.n,1);
    assert.equal(settlement.amount,-2400);

    const transaction=raw.prepare(
      `SELECT payment_document_id,status FROM payment_transactions
       WHERE organization_id=1 AND booking_id=?`
    ).get(bookingId);
    assert.equal(transaction.payment_document_id,firstBody.documentId);
    assert.equal(transaction.status,"paid");

    assert.throws(()=>raw.prepare("UPDATE cash_movements SET amount_delta=1 WHERE document_id=?").run(firstBody.documentId),/cash_movement_immutable/);
    assert.throws(()=>raw.prepare("DELETE FROM patient_settlement_movements WHERE document_id=?").run(firstBody.documentId),/patient_settlement_movement_immutable/);
    assert.throws(()=>raw.prepare("UPDATE finance_document_details SET amount=1 WHERE document_id=?").run(firstBody.documentId),/finance_document_not_draft/);
  });
});

test("refund is a separate posted document linked to the original payment and reverses money movement",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-FIN-REFUND",amount:3100});
    const cookie=await seedStaffSession(db,{email:"registrar@example.com",role:"registrar",organizationId:1});
    const paid=await pay(db,cookie,bookingId,"FIN-REFUND-REF");
    assert.equal(paid.status,200);
    const paidBody=await paid.json();

    const returned=await refund(db,cookie,bookingId);
    assert.equal(returned.status,200);
    const returnedBody=await returned.json();
    assert.equal(returnedBody.changed,true);
    assert.equal(returnedBody.legacy,false);
    assert.ok(returnedBody.documentId>0);

    const refundDocument=raw.prepare(
      `SELECT d.document_type,d.state,f.amount,f.source_document_id AS sourceDocumentId
       FROM business_documents d JOIN finance_document_details f ON f.document_id=d.id AND f.organization_id=d.organization_id
       WHERE d.organization_id=1 AND d.id=?`
    ).get(returnedBody.documentId);
    assert.equal(refundDocument.document_type,"refund");
    assert.equal(refundDocument.state,"posted");
    assert.equal(refundDocument.amount,3100);
    assert.equal(refundDocument.sourceDocumentId,paidBody.documentId);

    const cash=raw.prepare("SELECT amount_delta FROM cash_movements WHERE organization_id=1 AND document_id=?").get(returnedBody.documentId);
    const settlement=raw.prepare("SELECT amount_delta FROM patient_settlement_movements WHERE organization_id=1 AND document_id=?").get(returnedBody.documentId);
    assert.equal(cash.amount_delta,-3100);
    assert.equal(settlement.amount_delta,3100);

    const transaction=raw.prepare(
      `SELECT status,payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId
       FROM payment_transactions WHERE organization_id=1 AND booking_id=?`
    ).get(bookingId);
    assert.equal(transaction.status,"refunded");
    assert.equal(transaction.paymentDocumentId,paidBody.documentId);
    assert.equal(transaction.refundDocumentId,returnedBody.documentId);

    const again=await refund(db,cookie,bookingId);
    assert.equal(again.status,200);
    const againBody=await again.json();
    assert.equal(againBody.changed,false);
    assert.equal(againBody.documentId,returnedBody.documentId);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM business_documents WHERE organization_id=1 AND document_type='refund'").get().n,1);
  });
});

test("public payment initiation stays technical pending state and does not post business registers",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-FIN-PENDING",amount:1800});
    await db.prepare(
      `INSERT INTO app_settings (key,value) VALUES ('pay_link','https://pay.example/test')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run();
    const cookie=await seedPatientSession(db,"380501112233",1);
    const response=await callWorker(jsonRequest("/api/pay-link",{code:"RD-FIN-PENDING"},{headers:{cookie}}),db);
    assert.equal(response.status,200);

    const transaction=raw.prepare(
      `SELECT status,payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId
       FROM payment_transactions WHERE organization_id=1 AND booking_id=?`
    ).get(bookingId);
    assert.equal(transaction.status,"pending");
    assert.equal(transaction.paymentDocumentId,null);
    assert.equal(transaction.refundDocumentId,null);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM business_documents WHERE organization_id=1 AND document_type IN ('payment','refund')").get().n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM cash_movements WHERE organization_id=1").get().n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM patient_settlement_movements WHERE organization_id=1").get().n,0);
  });
});

test("finance journal is tenant scoped and does not expose another organization's documents",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Org Two','org-two',1)");
    const bookingId=await seedBooking(db,{code:"RD-FIN-ORG2",amount:2700,phone:"380671112233",organizationId:2});
    const org2=await seedStaffSession(db,{email:"org2@example.com",role:"registrar",organizationId:2});
    const org1=await seedStaffSession(db,{email:"org1@example.com",role:"registrar",organizationId:1});
    const paid=await pay(db,org2,bookingId,"ORG2-PAY");
    assert.equal(paid.status,200);

    const own=await callWorker(new Request("http://localhost/api/staff/finance",{headers:{cookie:org2}}),db);
    assert.equal(own.status,200);
    const ownBody=await own.json();
    assert.equal(ownBody.documents.length,1);
    assert.equal(ownBody.documents[0].bookingCode,"RD-FIN-ORG2");

    const foreign=await callWorker(new Request("http://localhost/api/staff/finance",{headers:{cookie:org1}}),db);
    assert.equal(foreign.status,200);
    const foreignBody=await foreign.json();
    assert.equal(foreignBody.documents.some((row)=>row.bookingCode==="RD-FIN-ORG2"),false);
    assert.equal(foreignBody.cashMovements.some((row)=>row.bookingCode==="RD-FIN-ORG2"),false);
  });
});
