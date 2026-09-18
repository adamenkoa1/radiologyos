import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{organizationId=1,code="RD-ORDER-001",amount=2600,category="civilian",status="confirmed",desiredTime="10:00"}={}){
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,'Order Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-25',?,?,'pending',?,0,?,2,'order-doctor@example.com','order-tech@example.com')`
  ).bind(organizationId,code,desiredTime,category,amount,status).run();
  return Number(result.meta.last_row_id);
}

function orderFor(raw,organizationId,bookingId){
  return raw.prepare(
    `SELECT d.id,d.number,d.state,d.basis_document_id AS basisDocumentId,
            o.booking_id AS bookingId,o.patient_category AS patientCategory,
            o.service_code AS serviceCode,o.service_title AS serviceTitle,o.equipment_id AS equipmentId,
            o.duration_minutes AS durationMinutes,o.price_amount AS priceAmount,o.charge_amount AS chargeAmount
     FROM patient_order_details o
     JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
     WHERE o.organization_id=? AND o.booking_id=?`
  ).get(organizationId,bookingId);
}

function appointmentFor(raw,organizationId,bookingId){
  return raw.prepare(
    `SELECT d.id,d.state,a.appointment_version AS version
     FROM appointment_details a
     JOIN business_documents d ON d.id=a.document_id AND d.organization_id=a.organization_id
     WHERE a.organization_id=? AND a.booking_id=? AND d.document_type='appointment' AND d.state='posted'
     ORDER BY a.appointment_version DESC LIMIT 1`
  ).get(organizationId,bookingId);
}

async function pay(db,cookie,bookingId,reference="ORDER-PAY"){
  return callWorker(jsonRequest("/api/staff/payments",{
    bookingId,method:"bank_transfer",providerReference:reference,
  },{headers:{cookie}}),db);
}

async function refund(db,cookie,bookingId){
  return callWorker(new Request("http://localhost/api/staff/payments",{
    method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId}),
  }),db);
}

async function storno(db,cookie,sourceDocumentId){
  return callWorker(jsonRequest("/api/staff/service-deliveries/corrections",{
    sourceDocumentId,reason:"Сторно для перевірки Patient Order root",
  },{headers:{cookie}}),db);
}

async function journal(db,cookie,id){
  return callWorker(new Request(`http://localhost/api/staff/business-documents?id=${id}`,{headers:{cookie}}),db);
}

test("every new booking automatically gets one draft Patient Order without an API-specific write path",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    const order=orderFor(raw,1,bookingId);
    assert.ok(order?.id>0);
    assert.equal(order.number,`ЗП-${String(order.id).padStart(6,"0")}`);
    assert.equal(order.state,"draft");
    assert.equal(order.basisDocumentId,null);
    assert.equal(order.bookingId,bookingId);
    assert.equal(order.patientCategory,"civilian");
    assert.equal(order.serviceCode,"ct-chest");
    assert.equal(order.serviceTitle,"КТ ОГК");
    assert.equal(order.equipmentId,"ct");
    assert.equal(order.durationMinutes,30);
    assert.equal(order.priceAmount,2600);
    assert.equal(order.chargeAmount,2600);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM patient_order_details WHERE organization_id=1 AND booking_id=?"
    ).get(bookingId).n,1);
  });
});

test("draft Patient Order follows commercial booking terms, then payment posts and freezes them",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-ORDER-PAY",amount:2400});
    let order=orderFor(raw,1,bookingId);
    assert.equal(order.state,"draft");

    await db.prepare(
      `UPDATE bookings SET service='КТ головного мозку',service_code='ct-brain',duration_minutes=25,payment_amount=2800
       WHERE organization_id=1 AND id=?`
    ).bind(bookingId).run();
    order=orderFor(raw,1,bookingId);
    assert.equal(order.serviceCode,"ct-brain");
    assert.equal(order.serviceTitle,"КТ головного мозку");
    assert.equal(order.durationMinutes,25);
    assert.equal(order.priceAmount,2800);
    assert.equal(order.chargeAmount,2800);

    const cookie=await seedStaffSession(db,{email:"order-pay@example.com",role:"registrar",organizationId:1});
    const paymentResponse=await pay(db,cookie,bookingId,"ORDER-ROOT-PAY");
    assert.equal(paymentResponse.status,200);
    const payment=await paymentResponse.json();
    order=orderFor(raw,1,bookingId);
    assert.equal(order.state,"posted");

    const paymentDoc=raw.prepare(
      "SELECT basis_document_id AS basisDocumentId,state FROM business_documents WHERE id=?"
    ).get(payment.documentId);
    assert.equal(paymentDoc.state,"posted");
    assert.equal(paymentDoc.basisDocumentId,order.id);

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET payment_amount=1 WHERE organization_id=1 AND id=?"
    ).run(bookingId),/patient_order_booking_terms_immutable/);
    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET service_code='changed' WHERE organization_id=1 AND id=?"
    ).run(bookingId),/patient_order_booking_terms_immutable/);

    // Appointment timing is not a commercial term of the Patient Order and may still be rescheduled.
    raw.prepare("UPDATE bookings SET desired_time='11:30' WHERE organization_id=1 AND id=?").run(bookingId);
    assert.equal(raw.prepare("SELECT desired_time FROM bookings WHERE id=?").get(bookingId).desired_time,"11:30");
  });
});

test("study completion posts the Patient Order and routes execution through the posted Appointment",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-ORDER-SERVICE",amount:3100});
    const draft=orderFor(raw,1,bookingId);
    assert.equal(draft.state,"draft");

    await db.prepare(
      `UPDATE bookings SET performed_at='2026-08-25T10:05:00',status='completed'
       WHERE organization_id=1 AND id=?`
    ).bind(bookingId).run();
    const order=orderFor(raw,1,bookingId);
    assert.equal(order.state,"posted");
    const service=raw.prepare(
      `SELECT d.id,d.number,d.state,d.basis_document_id AS basisDocumentId
       FROM business_documents d JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
       WHERE d.organization_id=1 AND s.booking_id=? AND d.document_type='service_delivery'`
    ).get(bookingId);
    assert.equal(service.state,"posted");
    const appointment=appointmentFor(raw,1,bookingId); assert.ok(appointment?.id>0);
    assert.equal(service.basisDocumentId,appointment.id);
    assert.notEqual(service.basisDocumentId,order.id);
    assert.match(service.number,/^НП-\d{6}$/);
  });
});

test("refund and service storno keep immediate basis while Patient Order remains the commercial root",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-ORDER-CHAIN",amount:3300});
    const cookie=await seedStaffSession(db,{email:"order-chain@example.com",role:"registrar",organizationId:1});
    const paymentResponse=await pay(db,cookie,bookingId,"ORDER-CHAIN-PAY");
    const payment=await paymentResponse.json();
    const order=orderFor(raw,1,bookingId);
    assert.equal(order.state,"posted");

    const refundResponse=await refund(db,cookie,bookingId);
    assert.equal(refundResponse.status,200);
    const returned=await refundResponse.json();
    const refundDoc=raw.prepare(
      "SELECT basis_document_id AS basisDocumentId FROM business_documents WHERE id=?"
    ).get(returned.documentId);
    assert.equal(refundDoc.basisDocumentId,payment.documentId);

    await db.prepare(
      `UPDATE bookings SET performed_at='2026-08-25T10:05:00',status='completed'
       WHERE organization_id=1 AND id=?`
    ).bind(bookingId).run();
    const service=raw.prepare(
      `SELECT d.id,d.basis_document_id AS basisDocumentId
       FROM business_documents d JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
       WHERE s.organization_id=1 AND s.booking_id=? AND d.document_type='service_delivery'`
    ).get(bookingId);
    const appointment=appointmentFor(raw,1,bookingId); assert.ok(appointment?.id>0);
    assert.equal(service.basisDocumentId,appointment.id);

    const stornoResponse=await storno(db,cookie,service.id);
    assert.equal(stornoResponse.status,201);
    const correction=await stornoResponse.json();
    const correctionDoc=raw.prepare(
      "SELECT basis_document_id AS basisDocumentId,reversed_document_id AS reversedDocumentId FROM business_documents WHERE id=?"
    ).get(correction.document.id);
    assert.equal(correctionDoc.basisDocumentId,service.id);
    assert.equal(correctionDoc.reversedDocumentId,service.id);
  });
});

test("unified document structure exposes Patient Order -> Appointment -> service while finance stays rooted in the order",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-ORDER-JOURNAL",amount:2900});
    const cookie=await seedStaffSession(db,{email:"order-journal@example.com",role:"registrar",organizationId:1});
    const paymentResponse=await pay(db,cookie,bookingId,"ORDER-JOURNAL-PAY");
    const payment=await paymentResponse.json();
    const refundResponse=await refund(db,cookie,bookingId);const returned=await refundResponse.json();
    await db.prepare(
      "UPDATE bookings SET performed_at='2026-08-25T10:05:00',status='completed' WHERE organization_id=1 AND id=?"
    ).bind(bookingId).run();
    const service=raw.prepare(
      `SELECT d.id FROM business_documents d JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
       WHERE s.organization_id=1 AND s.booking_id=? AND d.document_type='service_delivery'`
    ).get(bookingId);
    const stornoResponse=await storno(db,cookie,service.id);const correction=await stornoResponse.json();
    const order=orderFor(raw,1,bookingId);
    const appointment=appointmentFor(raw,1,bookingId); assert.ok(appointment?.id>0);

    const rootResponse=await journal(db,cookie,order.id);
    assert.equal(rootResponse.status,200);
    const root=await rootResponse.json();
    assert.equal(root.document.journalType,"patient_order");
    assert.equal(root.document.bookingCode,"RD-ORDER-JOURNAL");
    assert.equal(root.document.amount,2900);
    assert.ok(root.relations.children.some(row=>row.id===payment.documentId&&row.relationType==="based_on"));
    assert.ok(root.relations.children.some(row=>row.id===appointment.id&&row.relationType==="based_on"));
    assert.ok(!root.relations.children.some(row=>row.id===service.id&&row.relationType==="based_on"));

    const paymentDetail=await (await journal(db,cookie,payment.documentId)).json();
    assert.ok(paymentDetail.relations.parent.some(row=>row.id===order.id&&row.relationType==="based_on"));
    assert.ok(paymentDetail.relations.children.some(row=>row.id===returned.documentId&&row.relationType==="refund"));

    const appointmentDetail=await (await journal(db,cookie,appointment.id)).json();
    assert.ok(appointmentDetail.relations.parent.some(row=>row.id===order.id&&row.relationType==="based_on"));
    assert.ok(appointmentDetail.relations.children.some(row=>row.id===service.id&&row.relationType==="based_on"));

    const serviceDetail=await (await journal(db,cookie,service.id)).json();
    assert.ok(serviceDetail.relations.parent.some(row=>row.id===appointment.id&&row.relationType==="based_on"));
    assert.ok(serviceDetail.relations.children.some(row=>row.id===correction.document.id&&row.relationType==="storno"));
  });
});

test("D1 rejects a document that points at another booking's Patient Order",async()=>{
  await withD1(async(db,raw)=>{
    const first=await seedBooking(db,{code:"RD-ORDER-BASIS-1",amount:1500,desiredTime:"10:00"});
    const second=await seedBooking(db,{code:"RD-ORDER-BASIS-2",amount:1700,desiredTime:"10:30"});
    const wrongOrder=orderFor(raw,1,second);
    const created=raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,occurred_at,state,comment,created_by,basis_document_id)
       VALUES (1,'payment','ОП-FORGE',CURRENT_TIMESTAMP,'draft','forged','attacker@example.com',?)`
    ).run(wrongOrder.id);
    const docId=Number(created.lastInsertRowid);
    assert.throws(()=>raw.prepare(
      `INSERT INTO finance_document_details
       (organization_id,document_id,booking_id,patient_id,amount,currency,method,provider,provider_reference)
       VALUES (1,?,?, '',1500,'UAH','cash','manual','FORGE')`
    ).run(docId,first),/payment_patient_order_basis_mismatch/);
  });
});

test("basis is tenant scoped and immutable after document posting",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Order Org 2','order-org-2',1)");
    const one=await seedBooking(db,{code:"RD-ORDER-ORG1"});
    const two=await seedBooking(db,{organizationId:2,code:"RD-ORDER-ORG2"});
    const order1=orderFor(raw,1,one);const order2=orderFor(raw,2,two);

    assert.throws(()=>raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,occurred_at,state,comment,created_by,basis_document_id)
       VALUES (1,'payment','ОП-CROSS',CURRENT_TIMESTAMP,'draft','cross','attacker@example.com',?)`
    ).run(order2.id),/business_document_basis_tenant_mismatch/);

    const cookie=await seedStaffSession(db,{email:"order-freeze@example.com",role:"registrar",organizationId:1});
    const paid=await pay(db,cookie,one,"ORDER-FREEZE-PAY");const body=await paid.json();
    assert.throws(()=>raw.prepare(
      "UPDATE business_documents SET basis_document_id=NULL WHERE organization_id=1 AND id=?"
    ).run(body.documentId),/business_document_immutable/);
    assert.equal(raw.prepare("SELECT basis_document_id AS basis FROM business_documents WHERE id=?").get(body.documentId).basis,order1.id);
  });
});
