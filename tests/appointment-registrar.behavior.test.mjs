import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { callWorker,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{organizationId=1,code="RD-APT-001",date="2026-10-01",time="10:00",status="confirmed",service="КТ ОГК",serviceCode="ct-chest",equipmentId="ct",duration=30,patientId="PAT-APT"}={}){
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (?,?,'Appointment Patient','+380501234500','380501234500',?,'1980-01-02',?,?,?, ?,?,?,'civilian','pending',2500,0,?,1,'apt-doctor@example.com','apt-tech@example.com')`)
    .bind(organizationId,code,patientId,service,serviceCode,equipmentId,duration,date,time,status).run();
  return Number(result.meta.last_row_id);
}

function orderFor(raw,organizationId,bookingId){return raw.prepare(`SELECT d.id,d.state FROM patient_order_details o JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id WHERE o.organization_id=? AND o.booking_id=? LIMIT 1`).get(organizationId,bookingId);}
function appointments(raw,organizationId,bookingId){return raw.prepare(`SELECT d.id,d.number,d.state,d.basis_document_id AS basisDocumentId,
  a.appointment_version AS version,a.patient_id AS patientId,a.service_code AS serviceCode,a.service_title AS serviceTitle,
  a.equipment_id AS equipmentId,a.duration_minutes AS durationMinutes,a.scheduled_date AS scheduledDate,a.scheduled_time AS scheduledTime
  FROM appointment_details a JOIN business_documents d ON d.id=a.document_id AND d.organization_id=a.organization_id
  WHERE a.organization_id=? AND a.booking_id=? ORDER BY a.appointment_version`).all(organizationId,bookingId);}
async function journal(db,cookie,id){return callWorker(new Request(`http://localhost/api/staff/business-documents?id=${id}`,{headers:{cookie}}),db);}
function movementCount(raw,table,documentId){return Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id=?`).get(documentId).n);}

test("future booking creates posted Appointment v1 based on its Patient Order with zero movements",async()=>{
 await withD1(async(db,raw)=>{
  const bookingId=await seedBooking(db);
  const order=orderFor(raw,1,bookingId); assert.ok(order?.id>0);
  const rows=appointments(raw,1,bookingId); assert.equal(rows.length,1); const a=rows[0];
  assert.equal(a.number,`АП-${String(bookingId).padStart(6,"0")}-001`); assert.equal(a.state,"posted"); assert.equal(a.basisDocumentId,order.id); assert.equal(a.version,1);
  assert.equal(a.patientId,"PAT-APT"); assert.equal(a.serviceCode,"ct-chest"); assert.equal(a.serviceTitle,"КТ ОГК"); assert.equal(a.equipmentId,"ct"); assert.equal(a.durationMinutes,30); assert.equal(a.scheduledDate,"2026-10-01"); assert.equal(a.scheduledTime,"10:00");
  for(const table of ["cash_movements","patient_settlement_movements","revenue_movements","services_delivered_movements","service_correction_movements","equipment_load_movements","staff_output_movements","inventory_movements"]) assert.equal(movementCount(raw,table,a.id),0);
  const cookie=await seedStaffSession(db,{email:"apt-journal@example.com",role:"registrar",organizationId:1});
  const detailResponse=await journal(db,cookie,a.id); assert.equal(detailResponse.status,200); const detail=await detailResponse.json();
  assert.equal(detail.document.journalType,"appointment"); assert.equal(detail.document.bookingId,bookingId); assert.equal(detail.document.bookingCode,"RD-APT-001"); assert.equal(detail.document.patientName,"Appointment Patient"); assert.equal(detail.document.patientId,"PAT-APT"); assert.equal(detail.document.subject,"КТ ОГК"); assert.equal(detail.document.amount,0); assert.equal(detail.document.sourceDocumentId,order.id); assert.equal(detail.document.relationType,"based_on");
  assert.ok(detail.relations.parent.some(x=>x.id===order.id&&x.relationType==="based_on"));
 });
});

test("real reschedule reverses current appointment and appends exactly one next version; no-op creates nothing",async()=>{
 await withD1(async(db,raw)=>{
  const bookingId=await seedBooking(db,{code:"RD-APT-RESCHEDULE"});
  const v1=appointments(raw,1,bookingId)[0];
  await db.prepare("UPDATE bookings SET desired_date='2026-10-02',desired_time='11:30' WHERE organization_id=1 AND id=?").bind(bookingId).run();
  let rows=appointments(raw,1,bookingId); assert.equal(rows.length,2);
  assert.equal(rows[0].id,v1.id); assert.equal(rows[0].state,"reversed");
  assert.equal(rows[1].state,"posted"); assert.equal(rows[1].basisDocumentId,v1.id); assert.equal(rows[1].version,2); assert.equal(rows[1].scheduledDate,"2026-10-02"); assert.equal(rows[1].scheduledTime,"11:30");
  await db.prepare("UPDATE bookings SET desired_date=desired_date,desired_time=desired_time WHERE organization_id=1 AND id=?").bind(bookingId).run();
  assert.equal(appointments(raw,1,bookingId).length,2);
  await db.prepare("UPDATE bookings SET equipment_id='ct-2',duration_minutes=45 WHERE organization_id=1 AND id=?").bind(bookingId).run();
  rows=appointments(raw,1,bookingId); assert.equal(rows.length,3); assert.equal(rows[1].state,"reversed"); assert.equal(rows[2].state,"posted"); assert.equal(rows[2].basisDocumentId,rows[1].id); assert.equal(rows[2].version,3); assert.equal(rows[2].equipmentId,"ct-2"); assert.equal(rows[2].durationMinutes,45);
  assert.equal(rows.filter(x=>x.state==="posted").length,1);
 });
});

test("booking cancellation reverses current appointment without replacement; completion keeps it posted",async()=>{
 await withD1(async(db,raw)=>{
  const cancelledId=await seedBooking(db,{code:"RD-APT-CANCEL"});
  await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?").bind(cancelledId).run();
  const cancelled=appointments(raw,1,cancelledId); assert.equal(cancelled.length,1); assert.equal(cancelled[0].state,"reversed");
  assert.equal(orderFor(raw,1,cancelledId).state,"cancelled");

  const completedId=await seedBooking(db,{code:"RD-APT-COMPLETE",time:"12:00"});
  await db.prepare("UPDATE bookings SET performed_at='2026-10-01T12:05:00',status='completed' WHERE organization_id=1 AND id=?").bind(completedId).run();
  const completed=appointments(raw,1,completedId); assert.equal(completed.length,1); assert.equal(completed[0].state,"posted");
  const service=raw.prepare(`SELECT d.basis_document_id AS basisDocumentId FROM service_delivery_details s JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id WHERE s.organization_id=1 AND s.booking_id=? LIMIT 1`).get(completedId);
  assert.equal(service.basisDocumentId,orderFor(raw,1,completedId).id,"0095 must not change service-delivery Patient Order basis");
 });
});

test("D1 rejects independent appointment reversal and snapshot mutation",async()=>{
 await withD1(async(db,raw)=>{
  const bookingId=await seedBooking(db,{code:"RD-APT-GUARD"}); const a=appointments(raw,1,bookingId)[0];
  assert.throws(()=>raw.prepare("UPDATE business_documents SET state='reversed' WHERE id=?").run(a.id),/appointment_reversal_requires_booking_transition/);
  assert.throws(()=>raw.prepare("UPDATE appointment_details SET scheduled_time='23:59' WHERE document_id=?").run(a.id),/appointment_snapshot_immutable/);
  assert.throws(()=>raw.prepare("DELETE FROM appointment_details WHERE document_id=?").run(a.id),/appointment_snapshot_immutable/);
 });
});

test("D1 rejects forged appointment basis, tenant lineage and duplicate active version",async()=>{
 await withD1(async(db,raw)=>{
  raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Appointment Org 2','appointment-org-2',1)");
  const one=await seedBooking(db,{code:"RD-APT-ORG1"});
  const two=await seedBooking(db,{organizationId:2,code:"RD-APT-ORG2",patientId:"PAT-APT-2"});
  const order2=orderFor(raw,2,two); const active=appointments(raw,1,one)[0];
  assert.throws(()=>raw.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id) VALUES (1,'appointment',?,CURRENT_TIMESTAMP,'posted','Автоматично з планування заявки','system:schedule','system:schedule',CURRENT_TIMESTAMP,?)`).run(`АП-${String(one).padStart(6,"0")}-002`,order2.id),/business_document_basis_tenant_mismatch|appointment_basis_or_version_invalid/);
  assert.throws(()=>raw.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id) VALUES (1,'appointment',?,CURRENT_TIMESTAMP,'posted','Автоматично з планування заявки','system:schedule','system:schedule',CURRENT_TIMESTAMP,?)`).run(`АП-${String(one).padStart(6,"0")}-002`,active.id),/appointment_basis_or_version_invalid/);
 });
});

test("migration 0095 does not backfill historical bookings and business core already admits appointment type",async()=>{
 const migration=await readFile(new URL("../drizzle/0095_appointment_registrar.sql",import.meta.url),"utf8");
 const core=await readFile(new URL("../lib/business-core.ts",import.meta.url),"utf8");
 assert.match(core,/"appointment"/);
 assert.match(migration,/AFTER INSERT ON `patient_order_details`/);
 assert.match(migration,/Only bookings that already have appointment history participate/);
 assert.doesNotMatch(migration,/INSERT INTO `business_documents`[\s\S]*SELECT[\s\S]*FROM `bookings`[\s\S]*appointment/iu);
});
