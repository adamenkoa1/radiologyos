import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedCompleted(db,raw,{code="RD-DOC-JOURNAL",amount=3200,organizationId=1}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,'Journal Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-23','11:00','civilian','pending',?,0,'confirmed',2,'journal-doctor@example.com','journal-tech@example.com')`
  ).bind(organizationId,code,amount).run();
  const bookingId=Number(result.meta.last_row_id);
  await db.prepare(
    `UPDATE bookings SET performed_at='2026-08-23T11:05:00',status='completed'
     WHERE organization_id=? AND id=?`
  ).bind(organizationId,bookingId).run();
  const service=raw.prepare(
    `SELECT d.id,d.number FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=? AND s.booking_id=? AND d.document_type='service_delivery'`
  ).get(organizationId,bookingId);
  return {bookingId,serviceDocumentId:service.id,serviceNumber:service.number};
}

async function pay(db,cookie,bookingId,reference="DOC-JOURNAL-PAY") {
  return callWorker(jsonRequest("/api/staff/payments",{
    bookingId,method:"bank_transfer",providerReference:reference,
  },{headers:{cookie}}),db);
}

async function refund(db,cookie,bookingId) {
  return callWorker(new Request("http://localhost/api/staff/payments",{
    method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId}),
  }),db);
}

async function storno(db,cookie,sourceDocumentId) {
  return callWorker(jsonRequest("/api/staff/service-deliveries/corrections",{
    sourceDocumentId,reason:"Сторно для єдиного журналу документів",
  },{headers:{cookie}}),db);
}

async function journal(db,cookie,id=null) {
  const suffix=id?`?id=${id}`:"";
  return callWorker(new Request(`http://localhost/api/staff/business-documents${suffix}`,{headers:{cookie}}),db);
}

test("unified journal exposes service, payment, refund and storno as one tenant-scoped document stream",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw);
    const cookie=await seedStaffSession(db,{email:"doc-journal@example.com",role:"registrar",organizationId:1});

    const paymentResponse=await pay(db,cookie,seeded.bookingId,"DOC-JOURNAL-PAY-1");
    assert.equal(paymentResponse.status,200);
    const payment=await paymentResponse.json();
    const refundResponse=await refund(db,cookie,seeded.bookingId);
    assert.equal(refundResponse.status,200);
    const returned=await refundResponse.json();
    const stornoResponse=await storno(db,cookie,seeded.serviceDocumentId);
    assert.equal(stornoResponse.status,201);
    const correction=await stornoResponse.json();

    const response=await journal(db,cookie);
    assert.equal(response.status,200);
    const body=await response.json();
    const rows=body.documents;

    const service=rows.find(row=>row.id===seeded.serviceDocumentId);
    const payRow=rows.find(row=>row.id===payment.documentId);
    const refundRow=rows.find(row=>row.id===returned.documentId);
    const stornoRow=rows.find(row=>row.id===correction.document.id);
    assert.equal(service.journalType,"service_delivery");
    assert.equal(service.state,"reversed");
    assert.equal(service.bookingCode,"RD-DOC-JOURNAL");
    assert.equal(service.amount,3200);
    assert.equal(payRow.journalType,"payment");
    assert.equal(refundRow.journalType,"refund");
    assert.equal(refundRow.sourceDocumentId,payment.documentId);
    assert.equal(refundRow.relationType,"refund_of");
    assert.equal(stornoRow.journalType,"service_correction");
    assert.equal(stornoRow.sourceDocumentId,seeded.serviceDocumentId);
    assert.equal(stornoRow.relationType,"storno_of");
    assert.equal(stornoRow.amount,3200);
  });
});

test("document structure shows canonical parents, children and exact register movements",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-DOC-STRUCT",amount:2700});
    const cookie=await seedStaffSession(db,{email:"doc-structure@example.com",role:"registrar",organizationId:1});
    const paymentResponse=await pay(db,cookie,seeded.bookingId,"DOC-STRUCT-PAY");
    const payment=await paymentResponse.json();
    const refundResponse=await refund(db,cookie,seeded.bookingId);
    const returned=await refundResponse.json();
    const stornoResponse=await storno(db,cookie,seeded.serviceDocumentId);
    const correction=await stornoResponse.json();

    const serviceDetailResponse=await journal(db,cookie,seeded.serviceDocumentId);
    assert.equal(serviceDetailResponse.status,200);
    const serviceDetail=await serviceDetailResponse.json();
    assert.ok(serviceDetail.relations.children.some(row=>row.id===correction.document.id && row.relationType==="storno"));
    const performanceRelation=serviceDetail.relations.children.find(
      row=>row.documentType==="study_performance" && row.relationType==="based_on",
    );
    assert.ok(performanceRelation?.id>0);
    assert.equal(serviceDetail.movements.services.length,0);
    assert.equal(serviceDetail.movements.revenue.length,1);
    assert.equal(serviceDetail.movements.settlement.length,1);
    assert.equal(serviceDetail.movements.equipment.length,0);
    assert.equal(serviceDetail.movements.staff.length,0);
    assert.equal(serviceDetail.movements.cash.length,0);

    const performanceDetailResponse=await journal(db,cookie,performanceRelation.id);
    assert.equal(performanceDetailResponse.status,200);
    const performanceDetail=await performanceDetailResponse.json();
    assert.ok(performanceDetail.relations.parent.some(
      row=>row.id===seeded.serviceDocumentId && row.relationType==="based_on",
    ));
    assert.equal(performanceDetail.document.state,"reversed");
    assert.equal(performanceDetail.movements.services.length,1);
    assert.equal(performanceDetail.movements.revenue.length,0);
    assert.equal(performanceDetail.movements.settlement.length,0);
    assert.equal(performanceDetail.movements.equipment.length,1);
    assert.equal(performanceDetail.movements.staff.length,2);
    assert.equal(performanceDetail.movements.cash.length,0);

    const correctionDetailResponse=await journal(db,cookie,correction.document.id);
    assert.equal(correctionDetailResponse.status,200);
    const correctionDetail=await correctionDetailResponse.json();
    assert.ok(correctionDetail.relations.parent.some(row=>row.id===seeded.serviceDocumentId && row.relationType==="storno_of"));
    assert.equal(correctionDetail.movements.corrections.length,1);
    assert.equal(correctionDetail.movements.revenue[0].amountDelta,-2700);
    assert.equal(correctionDetail.movements.settlement[0].amountDelta,-2700);
    assert.equal(correctionDetail.movements.equipment[0].minutesDelta,-30);
    assert.equal(correctionDetail.movements.staff.length,2);
    assert.equal(correctionDetail.movements.cash.length,0);

    const paymentDetailResponse=await journal(db,cookie,payment.documentId);
    const paymentDetail=await paymentDetailResponse.json();
    assert.ok(paymentDetail.relations.children.some(row=>row.id===returned.documentId && row.relationType==="refund"));
    assert.equal(paymentDetail.movements.cash[0].amountDelta,2700);
    assert.equal(paymentDetail.movements.settlement[0].amountDelta,-2700);

    const refundDetailResponse=await journal(db,cookie,returned.documentId);
    const refundDetail=await refundDetailResponse.json();
    assert.ok(refundDetail.relations.parent.some(row=>row.id===payment.documentId && row.relationType==="refund_of"));
    assert.equal(refundDetail.movements.cash[0].amountDelta,-2700);
    assert.equal(refundDetail.movements.settlement[0].amountDelta,2700);
  });
});

test("document structure includes immutable printed-form evidence",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-DOC-PRINT",amount:2300});
    const cookie=await seedStaffSession(db,{email:"doc-print@example.com",role:"registrar",organizationId:1});
    const printed=await callWorker(jsonRequest("/api/staff/service-deliveries/print",{
      documentId:seeded.serviceDocumentId,
    },{headers:{cookie}}),db);
    assert.equal(printed.status,201);
    const printBody=await printed.json();

    const detailResponse=await journal(db,cookie,seeded.serviceDocumentId);
    assert.equal(detailResponse.status,200);
    const detail=await detailResponse.json();
    assert.equal(detail.printedForms.length,1);
    assert.equal(detail.printedForms[0].id,printBody.snapshot.id);
    assert.equal(detail.printedForms[0].formType,"service_act");
    assert.equal(detail.printedForms[0].sha256.length,64);
  });
});

test("business document journal is tenant isolated for both list and detail",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Document Org 2','document-org-2',1)");
    const foreign=await seedCompleted(db,raw,{organizationId:2,code:"RD-DOC-ORG2",amount:1900});
    const org1=await seedStaffSession(db,{email:"doc-org1@example.com",role:"registrar",organizationId:1});
    const org2=await seedStaffSession(db,{email:"doc-org2@example.com",role:"registrar",organizationId:2});

    const list1=await journal(db,org1);
    const body1=await list1.json();
    assert.equal(body1.documents.some(row=>row.id===foreign.serviceDocumentId),false);

    const foreignDetail=await journal(db,org1,foreign.serviceDocumentId);
    assert.equal(foreignDetail.status,404);
    const ownDetail=await journal(db,org2,foreign.serviceDocumentId);
    assert.equal(ownDetail.status,200);
  });
});

test("clinical-only role cannot read the patient-level business document journal",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-DOC-ROLE"});
    const doctor=await seedStaffSession(db,{email:"doc-role-doctor@example.com",role:"radiologist",organizationId:1});
    const list=await journal(db,doctor);
    assert.equal(list.status,403);
    const detail=await journal(db,doctor,seeded.serviceDocumentId);
    assert.equal(detail.status,403);
  });
});