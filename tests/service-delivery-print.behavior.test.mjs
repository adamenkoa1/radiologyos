import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedAct(db,{organizationId=1,code="RD-ACT-PRINT",name="Пацієнт Акт",time="14:00"}={}) {
  const rad=`act-print-rad-${organizationId}@example.com`;
  const tech=`act-print-tech-${organizationId}@example.com`;
  await seedStaffSession(db,{email:rad,role:"radiologist",organizationId});
  await seedStaffSession(db,{email:tech,role:"radiographer",organizationId});
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,duration_minutes,
      desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
      assigned_radiologist_email,assigned_radiographer_email,anatomical_regions_count,performed_at
    ) VALUES (?,?,?,'+380501234567','380501234567','КТ органів грудної клітки','ct-chest','ct',30,
      '2026-08-26',?,'civilian','pending',2700,0,'completed',?,?,2,?)`
  ).bind(organizationId,code,name,time,rad,tech,`2026-08-26T${time}:00`).run();
  const bookingId=Number(result.meta.last_row_id);
  await db.prepare(
    `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
     VALUES (?,?,'execution_recorded','print test',?)`
  ).bind(organizationId,bookingId,rad).run();
  const act=await db.prepare(
    `SELECT document_id AS documentId FROM service_delivery_details
     WHERE organization_id=? AND booking_id=? LIMIT 1`
  ).bind(organizationId,bookingId).first();
  return {bookingId,documentId:Number(act?.documentId || 0)};
}

async function printAct(db,cookie,documentId) {
  return callWorker(jsonRequest("/api/staff/service-delivery/print",{documentId},{headers:{cookie}}),db);
}

test("posted service act reuses one immutable historical snapshot",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"act-print-reg@example.com",role:"registrar",organizationId:1});
    const {bookingId,documentId}=await seedAct(db);
    assert.ok(documentId>0);

    const first=await printAct(db,cookie,documentId);
    assert.equal(first.status,201);
    const form1=await first.json();
    assert.equal(form1.snapshot.formType,"service_act");
    assert.equal(form1.snapshot.documentState,"posted");
    assert.equal(form1.snapshot.templateVersion,1);
    assert.equal(form1.snapshot.sha256.length,64);
    assert.equal(form1.payload.booking.patientName,"Пацієнт Акт");
    assert.equal(form1.payload.service.name,"КТ органів грудної клітки");
    assert.equal(form1.payload.service.chargeAmount,2700);
    assert.equal(form1.payload.execution.anatomicalRegionsCount,2);

    // Patient display name is not an economic posting field; an exact reprint must still use the historical snapshot.
    await db.prepare("UPDATE bookings SET name='Пацієнт Після Зміни' WHERE organization_id=1 AND id=?")
      .bind(bookingId).run();
    const again=await printAct(db,cookie,documentId);
    assert.equal(again.status,200);
    const form2=await again.json();
    assert.equal(form2.snapshot.id,form1.snapshot.id);
    assert.equal(form2.snapshot.sha256,form1.snapshot.sha256);
    assert.equal(form2.payload.booking.patientName,"Пацієнт Акт");

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

test("service act snapshots are role gated and tenant scoped",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Act Print Org 2','act-print-org-2',1)");
    const org2=await seedStaffSession(db,{email:"act-print-org2@example.com",role:"registrar",organizationId:2});
    const org1=await seedStaffSession(db,{email:"act-print-org1@example.com",role:"registrar",organizationId:1});
    const clinician=await seedStaffSession(db,{email:"act-print-clinician@example.com",role:"radiologist",organizationId:1});
    const {documentId}=await seedAct(db,{organizationId:2,code:"RD-ACT-PRINT-ORG2",name:"Інша Організація",time:"15:00"});

    const printed=await printAct(db,org2,documentId);
    assert.equal(printed.status,201);
    const {snapshot}=await printed.json();

    const foreign=await callWorker(new Request(
      `http://localhost/api/staff/service-delivery/print?snapshotId=${snapshot.id}`,
      {headers:{cookie:org1}},
    ),db);
    assert.equal(foreign.status,404);

    const denied=await callWorker(new Request(
      `http://localhost/api/staff/service-delivery/print?snapshotId=${snapshot.id}`,
      {headers:{cookie:clinician}},
    ),db);
    assert.equal(denied.status,403);
  });
});

test("D1 rejects a service_act snapshot linked to a non-service document",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"act-print-forge@example.com",role:"registrar",organizationId:1});
    const {documentId}=await seedAct(db,{code:"RD-ACT-PRINT-D1",time:"16:00"});
    const printed=await printAct(db,cookie,documentId);
    assert.equal(printed.status,201);

    const payment=raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,state,created_by,posted_by,posted_at)
       VALUES (1,'payment','FORGED-PAY','posted','x','x',CURRENT_TIMESTAMP)`
    ).run();
    assert.throws(()=>raw.prepare(
      `INSERT INTO printed_form_snapshots
       (organization_id,document_id,form_type,template_version,document_state,payload_json,generated_by,sha256)
       VALUES (1,?,'service_act',1,'posted','{}','x','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`
    ).run(Number(payment.lastInsertRowid)),/printed_form_document_mismatch/);
  });
});
