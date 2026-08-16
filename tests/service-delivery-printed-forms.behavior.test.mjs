import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedCompletedService(db,raw,{organizationId=1,code="RD-SVC-ACT",category="civilian",amount=2900,name="Пацієнт для Акта"}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,?,'+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-20','14:00',?,'pending',?,0,'confirmed',2,'doctor-act@example.com','tech-act@example.com')`
  ).bind(organizationId,code,name,category,amount).run();
  const bookingId=Number(result.meta.last_row_id);
  await db.prepare(
    `UPDATE bookings SET performed_at='2026-08-20T14:05:00',status='completed'
     WHERE organization_id=? AND id=?`
  ).bind(organizationId,bookingId).run();
  const document=raw.prepare(
    `SELECT d.id,d.number
     FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=? AND s.booking_id=? AND d.document_type='service_delivery'`
  ).get(organizationId,bookingId);
  return {bookingId,documentId:document.id,documentNumber:document.number};
}

async function printAct(db,cookie,documentId) {
  return callWorker(jsonRequest("/api/staff/service-deliveries/print",{documentId},{headers:{cookie}}),db);
}

test("posted service act reuses one immutable historical snapshot",async()=>{
  await withD1(async(db,raw)=>{
    const service=await seedCompletedService(db,raw);
    const cookie=await seedStaffSession(db,{email:"service-act@example.com",role:"registrar",organizationId:1});

    const first=await printAct(db,cookie,service.documentId);
    assert.equal(first.status,201);
    const form1=await first.json();
    assert.equal(form1.snapshot.formType,"service_act");
    assert.equal(form1.snapshot.documentState,"posted");
    assert.equal(form1.snapshot.templateVersion,1);
    assert.equal(form1.snapshot.sha256.length,64);
    assert.equal(form1.payload.document.number,service.documentNumber);
    assert.equal(form1.payload.booking.patientName,"Пацієнт для Акта");
    assert.equal(form1.payload.service.title,"КТ ОГК");
    assert.equal(form1.payload.service.chargeAmount,2900);
    assert.equal(form1.payload.service.anatomicalRegionsCount,2);

    // Name is master-data presentation, not a posted economic field. Historical reprint must still
    // preserve the name captured by the first printed snapshot.
    await db.prepare("UPDATE bookings SET name='Пацієнт Перейменований' WHERE organization_id=1 AND id=?")
      .bind(service.bookingId).run();

    const again=await printAct(db,cookie,service.documentId);
    assert.equal(again.status,200);
    const form2=await again.json();
    assert.equal(form2.snapshot.id,form1.snapshot.id);
    assert.equal(form2.snapshot.sha256,form1.snapshot.sha256);
    assert.equal(form2.payload.booking.patientName,"Пацієнт для Акта");

    assert.equal(raw.prepare(
      `SELECT COUNT(*) AS n FROM printed_form_snapshots
       WHERE organization_id=1 AND document_id=? AND form_type='service_act' AND document_state='posted'`
    ).get(service.documentId).n,1);
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

test("D1 rejects a forged service-act payload even for a real posted document",async()=>{
  await withD1(async(db,raw)=>{
    const service=await seedCompletedService(db,raw,{code:"RD-SVC-ACT-FORGE"});
    assert.throws(()=>raw.prepare(
      `INSERT INTO printed_form_snapshots
       (organization_id,document_id,form_type,template_version,document_state,payload_json,generated_by,sha256)
       VALUES (1,?,'service_act',1,'posted','{}','attacker@example.com',?)`
    ).run(service.documentId,"0".repeat(64)),/printed_service_act_document_mismatch/);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM printed_form_snapshots WHERE document_id=? AND form_type='service_act'"
    ).get(service.documentId).n,0);
  });
});

test("service-act snapshots are tenant scoped",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Service Act Org 2','service-act-org-2',1)");
    const service=await seedCompletedService(db,raw,{organizationId:2,code:"RD-SVC-ACT-ORG2",amount:1800});
    const org2=await seedStaffSession(db,{email:"act-org2@example.com",role:"registrar",organizationId:2});
    const org1=await seedStaffSession(db,{email:"act-org1@example.com",role:"registrar",organizationId:1});

    const printed=await printAct(db,org2,service.documentId);
    assert.equal(printed.status,201);
    const {snapshot}=await printed.json();

    const foreign=await callWorker(new Request(
      `http://localhost/api/staff/service-deliveries/print?snapshotId=${snapshot.id}`,
      {headers:{cookie:org1}},
    ),db);
    assert.equal(foreign.status,404);

    const own=await callWorker(new Request(
      `http://localhost/api/staff/service-deliveries/print?snapshotId=${snapshot.id}`,
      {headers:{cookie:org2}},
    ),db);
    assert.equal(own.status,200);
  });
});

test("clinical-only staff cannot print the finance service act",async()=>{
  await withD1(async(db,raw)=>{
    const service=await seedCompletedService(db,raw,{code:"RD-SVC-ACT-ROLE"});
    const doctor=await seedStaffSession(db,{email:"doctor-act-role@example.com",role:"radiologist",organizationId:1});
    const response=await printAct(db,doctor,service.documentId);
    assert.equal(response.status,403);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM printed_form_snapshots WHERE document_id=? AND form_type='service_act'"
    ).get(service.documentId).n,0);
  });
});
