import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-FIN-PRINT",amount=2800,organizationId=1,name="Пацієнт Оригінальний"}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status
     ) VALUES (?,?,?,'+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-20','13:00','civilian','pending',?,0,'confirmed')`
  ).bind(organizationId,code,name,amount).run();
  return Number(result.meta.last_row_id);
}

async function pay(db,cookie,bookingId,reference) {
  return callWorker(jsonRequest("/api/staff/payments",{
    bookingId,method:"bank_transfer",providerReference:reference,
  },{headers:{cookie}}),db);
}

async function printDocument(db,cookie,documentId) {
  return callWorker(jsonRequest("/api/staff/finance/print",{documentId},{headers:{cookie}}),db);
}

test("posted payment receipt reuses its immutable historical snapshot",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    const cookie=await seedStaffSession(db,{email:"finance-print@example.com",role:"registrar",organizationId:1});
    const payment=await pay(db,cookie,bookingId,"PRINT-PAY-1");
    assert.equal(payment.status,200);
    const paid=await payment.json();

    const first=await printDocument(db,cookie,paid.documentId);
    assert.equal(first.status,201);
    const form1=await first.json();
    assert.equal(form1.snapshot.formType,"payment_receipt");
    assert.equal(form1.snapshot.documentState,"posted");
    assert.equal(form1.snapshot.templateVersion,1);
    assert.equal(form1.snapshot.sha256.length,64);
    assert.equal(form1.payload.booking.patientName,"Пацієнт Оригінальний");
    assert.equal(form1.payload.booking.service,"КТ ОГК");
    assert.equal(form1.payload.payment.amount,2800);

    await db.prepare(
      "UPDATE bookings SET name='Пацієнт Перейменований' WHERE organization_id=1 AND id=?"
    ).bind(bookingId).run();

    const again=await printDocument(db,cookie,paid.documentId);
    assert.equal(again.status,200);
    const form2=await again.json();
    assert.equal(form2.snapshot.id,form1.snapshot.id);
    assert.equal(form2.snapshot.sha256,form1.snapshot.sha256);
    assert.equal(form2.payload.booking.patientName,"Пацієнт Оригінальний");
    assert.equal(form2.payload.booking.service,"КТ ОГК");

    assert.throws(
      ()=>raw.prepare("UPDATE printed_form_snapshots SET generated_by='tamper@example.com' WHERE id=?").run(form1.snapshot.id),
      /printed_form_snapshot_immutable/,
    );
    assert.throws(
      ()=>raw.prepare("DELETE FROM printed_form_snapshots WHERE id=?").run(form1.snapshot.id),
      /printed_form_snapshot_immutable/,
    );
  });
});

test("refund receipt snapshots the original payment document as its source",async()=>{
  await withD1(async(db)=>{
    const bookingId=await seedBooking(db,{code:"RD-FIN-PRINT-REFUND",amount:3300});
    const cookie=await seedStaffSession(db,{email:"finance-refund-print@example.com",role:"registrar",organizationId:1});
    const payment=await pay(db,cookie,bookingId,"PRINT-PAY-2");
    const paid=await payment.json();
    const refund=await callWorker(new Request("http://localhost/api/staff/payments",{
      method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId}),
    }),db);
    assert.equal(refund.status,200);
    const returned=await refund.json();

    const printed=await printDocument(db,cookie,returned.documentId);
    assert.equal(printed.status,201);
    const form=await printed.json();
    assert.equal(form.payload.document.documentType,"refund");
    assert.equal(form.payload.sourceDocument.documentType,"payment");
    assert.match(form.payload.sourceDocument.number,/^ОП-\d{6}$/);
    assert.notEqual(returned.documentId,paid.documentId);
  });
});

test("finance receipt snapshots are tenant scoped",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Finance Print Org 2','finance-print-org-2',1)");
    const bookingId=await seedBooking(db,{code:"RD-FIN-PRINT-ORG2",amount:2100,organizationId:2});
    const org2=await seedStaffSession(db,{email:"print-org2@example.com",role:"registrar",organizationId:2});
    const org1=await seedStaffSession(db,{email:"print-org1@example.com",role:"registrar",organizationId:1});
    const payment=await pay(db,org2,bookingId,"PRINT-ORG2");
    const paid=await payment.json();
    const printed=await printDocument(db,org2,paid.documentId);
    assert.equal(printed.status,201);
    const {snapshot}=await printed.json();

    const foreign=await callWorker(new Request(
      `http://localhost/api/staff/finance/print?snapshotId=${snapshot.id}`,
      {headers:{cookie:org1}},
    ),db);
    assert.equal(foreign.status,404);

    const own=await callWorker(new Request(
      `http://localhost/api/staff/finance/print?snapshotId=${snapshot.id}`,
      {headers:{cookie:org2}},
    ),db);
    assert.equal(own.status,200);
  });
});