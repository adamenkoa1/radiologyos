import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedPatientSession,seedStaffSession,withD1 } from "./helpers/d1.mjs";

const PHONE="380501119988";

async function seedBooking(db,{code="RD-ADD-DELIVERY",organizationId=1,patientId="PAT-ADD-DELIVERY",doctor="add-delivery-doctor@example.com"}={}) {
  await db.prepare(`INSERT OR IGNORE INTO patient_profiles
    (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES (?,?,?,'Addendum Delivery Patient','test')`).bind(patientId,organizationId,PHONE).run();
  const r=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (?,?,'Addendum Delivery Patient',?,? ,?,'1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-09-25','10:00','civilian','pending',2500,0,'confirmed',2,?,'add-delivery-tech@example.com')`)
    .bind(organizationId,code,`+${PHONE}`,PHONE,patientId,doctor).run();
  return Number(r.meta.last_row_id);
}

function seedLegacyIssuedProtocol(raw,{code="RD-ADD-LEGACY",doctor="legacy-add-doctor@example.com"}={}) {
  const result=raw.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,date_of_birth,service,desired_date,desired_time,
     status,protocol_status,protocol_issued_at,assigned_radiologist_email)
    VALUES (1,?,'Legacy Addendum Patient','+380501119977','380501119977','1980-01-02','КТ ОГК',
      '2026-09-25','11:00','completed','issued',CURRENT_TIMESTAMP,?)`).run(code,doctor);
  const bookingId=Number(result.lastInsertRowid);
  raw.prepare(`INSERT INTO protocols
    (organization_id,booking_id,number,status,version,author_email,updated_by,findings,conclusion,
     signed_by,signed_at,signed_version)
    VALUES (1,?,'LEGACY-P','issued',1,?,?, 'Опис','Висновок',?,CURRENT_TIMESTAMP,1)`)
    .run(bookingId,doctor,doctor,doctor);
  return bookingId;
}

function protocolPayload(bookingId,baseVersion,status) { return {
  bookingId,baseVersion,status,templateKey:"generic",method:"КТ без контрастування",sections:{},
  findings:"Основний опис",conclusion:"Основний висновок",recommendations:"",number:`P-ADD-${bookingId}`,
}; }
async function putProtocol(db,cookie,payload){return callWorker(jsonRequest("/api/staff/protocols",payload,{method:"PUT",headers:{cookie}}),db);}
async function issueBase(db,doctor,bookingId){
  await db.prepare("UPDATE bookings SET performed_at='2026-09-25T10:05:00',status='completed' WHERE organization_id=1 AND id=?").bind(bookingId).run();
  let r=await putProtocol(db,doctor,protocolPayload(bookingId,0,"ready")); assert.equal(r.status,200); let b=await r.json();
  r=await putProtocol(db,doctor,protocolPayload(bookingId,b.version,"signed")); assert.equal(r.status,200); b=await r.json();
  r=await putProtocol(db,doctor,protocolPayload(bookingId,b.version,"issued")); assert.equal(r.status,200);
  return r.json();
}
async function createAndIssueAddendum(db,doctor,manager,bookingId){
  let r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{bookingId,reason:"Уточнення",correctionText:"У висновку слід читати: без гострих змін."},{method:"POST",headers:{cookie:manager}}),db);
  assert.equal(r.status,201); let b=await r.json(); const id=b.addendum.id;
  r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{id,baseVersion:1,reason:"Уточнення",correctionText:"У висновку слід читати: без гострих змін.",status:"ready"},{method:"PUT",headers:{cookie:manager}}),db); assert.equal(r.status,200); b=await r.json();
  r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{id,baseVersion:b.addendum.version,reason:"Уточнення",correctionText:"У висновку слід читати: без гострих змін.",status:"signed"},{method:"PUT",headers:{cookie:doctor}}),db); assert.equal(r.status,200); b=await r.json(); const signed=b.addendum;
  r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{id,baseVersion:signed.version,reason:signed.reason,correctionText:signed.correctionText,status:"issued"},{method:"PUT",headers:{cookie:manager}}),db); assert.equal(r.status,200);
  return {id,signed,issued:(await r.json()).addendum};
}
function baseDelivery(raw,bookingId){return raw.prepare(`SELECT d.id FROM business_documents d JOIN result_delivery_details r ON r.document_id=d.id AND r.organization_id=d.organization_id WHERE r.organization_id=1 AND r.booking_id=? LIMIT 1`).get(bookingId);}
function addendumDelivery(raw,id,organizationId=1){return raw.prepare(`SELECT d.id,d.number,d.state,d.basis_document_id AS basisDocumentId,d.created_by AS createdBy,d.posted_by AS postedBy,d.posted_at AS postedAt,
  x.addendum_id AS addendumId,x.booking_id AS bookingId,x.patient_id AS patientId,x.service_title AS serviceTitle,x.base_protocol_number AS baseProtocolNumber,
  x.base_protocol_version AS baseProtocolVersion,x.addendum_version AS addendumVersion,x.signed_by AS signedBy,x.signed_at AS signedAt,x.delivered_by AS deliveredBy,x.delivered_at AS deliveredAt
  FROM business_documents d JOIN result_addendum_delivery_details x ON x.document_id=d.id AND x.organization_id=d.organization_id
  WHERE d.organization_id=? AND x.addendum_id=? LIMIT 1`).get(organizationId,id);}
async function journal(db,cookie,id=null){return callWorker(new Request(`http://localhost/api/staff/business-documents${id?`?id=${id}`:""}`,{headers:{cookie}}),db);}
function movementCount(raw,table,documentId){return Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id=?`).get(documentId).n);}

test("issued addendum atomically creates immutable neutral result-delivery subtype based on base delivery",async()=>{
 await withD1(async(db,raw)=>{
  const doctorEmail="add-delivery-doctor@example.com";
  const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1});
  const managerEmail="add-delivery-admin@example.com";
  const manager=await seedStaffSession(db,{email:managerEmail,role:"admin",organizationId:1});
  const registrar=await seedStaffSession(db,{email:"add-delivery-registrar@example.com",role:"registrar",organizationId:1});
  const bookingId=await seedBooking(db,{doctor:doctorEmail}); await issueBase(db,doctor,bookingId);
  const base=baseDelivery(raw,bookingId); assert.ok(base?.id>0);
  const {id,signed,issued}=await createAndIssueAddendum(db,doctor,manager,bookingId);
  assert.equal(issued.version,signed.version); const delivery=addendumDelivery(raw,id); assert.ok(delivery?.id>0);
  assert.equal(delivery.number,`ВК-${id}`); assert.equal(delivery.state,"posted"); assert.equal(delivery.basisDocumentId,base.id);
  assert.equal(delivery.bookingId,bookingId); assert.equal(delivery.patientId,"PAT-ADD-DELIVERY"); assert.equal(delivery.serviceTitle,"КТ ОГК");
  assert.equal(delivery.baseProtocolNumber,`P-ADD-${bookingId}`); assert.equal(delivery.baseProtocolVersion,2); assert.equal(delivery.addendumVersion,signed.version);
  assert.equal(delivery.signedBy,doctorEmail); assert.equal(delivery.signedAt,signed.signedAt); assert.equal(delivery.deliveredBy,managerEmail); assert.equal(delivery.createdBy,managerEmail); assert.equal(delivery.postedBy,managerEmail); assert.equal(delivery.deliveredAt,delivery.postedAt);
  for(const table of ["cash_movements","patient_settlement_movements","revenue_movements","services_delivered_movements","service_correction_movements","equipment_load_movements","staff_output_movements","inventory_movements"]) assert.equal(movementCount(raw,table,delivery.id),0);
  const jr=await journal(db,registrar); assert.equal(jr.status,200); const list=await jr.json(); const row=list.documents.find(x=>x.id===delivery.id);
  assert.equal(row.journalType,"result_addendum_delivery"); assert.equal(row.bookingId,bookingId); assert.equal(row.bookingCode,"RD-ADD-DELIVERY"); assert.equal(row.patientName,"Addendum Delivery Patient"); assert.equal(row.patientId,"PAT-ADD-DELIVERY"); assert.equal(row.subject,"КТ ОГК"); assert.equal(row.amount,0); assert.equal(row.sourceDocumentId,base.id); assert.equal(row.relationType,"based_on");
  const detailResponse=await journal(db,registrar,delivery.id); assert.equal(detailResponse.status,200); const detail=await detailResponse.json(); assert.ok(detail.relations.parent.some(x=>x.id===base.id && x.relationType==="based_on"));
  await assert.rejects(db.prepare("UPDATE result_addendum_delivery_details SET service_title='tamper' WHERE document_id=?").bind(delivery.id).run(),/snapshot_immutable/i);
  await assert.rejects(db.prepare("DELETE FROM result_addendum_delivery_details WHERE document_id=?").bind(delivery.id).run(),/snapshot_immutable/i);
  await assert.rejects(db.prepare("UPDATE business_documents SET state='reversed' WHERE id=?").bind(delivery.id).run(),/result_delivery_document_immutable/i);
  await assert.rejects(db.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id) VALUES (1,'result_delivery',?,CURRENT_TIMESTAMP,'posted','Видача виправлення до протоколу пацієнту',?,?,CURRENT_TIMESTAMP,?)`).bind(delivery.number,managerEmail,managerEmail,base.id).run(),/UNIQUE constraint failed/i);
  const patient=await seedPatientSession(db,PHONE,1,{kind:"booking",value:"RD-ADD-DELIVERY"},"PAT-ADD-DELIVERY");
  const pr=await callWorker(jsonRequest("/api/my-protocol",{code:"RD-ADD-DELIVERY"},{method:"POST",headers:{cookie:patient}}),db); assert.equal(pr.status,200); const pb=await pr.json(); assert.equal(pb.protocol.addenda.some(a=>a.id===id),true);
 });
});

test("legacy issued protocol without base delivery creates addendum delivery with null basis",async()=>{
 await withD1(async(db,raw)=>{
  const doctorEmail="legacy-add-doctor@example.com";
  const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1});
  const manager=await seedStaffSession(db,{email:"legacy-add-admin@example.com",role:"admin",organizationId:1});
  const bookingId=seedLegacyIssuedProtocol(raw,{doctor:doctorEmail});
  assert.equal(baseDelivery(raw,bookingId),undefined);
  const {id}=await createAndIssueAddendum(db,doctor,manager,bookingId); const delivery=addendumDelivery(raw,id); assert.ok(delivery?.id>0); assert.equal(delivery.basisDocumentId,null); assert.equal(delivery.baseProtocolVersion,1);
 });
});

test("addendum delivery fails closed for forged lineage and remains tenant isolated",async()=>{
 await withD1(async(db,raw)=>{
  const doctorEmail="guard-add-doctor@example.com";
  const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1});
  const manager=await seedStaffSession(db,{email:"guard-add-admin@example.com",role:"admin",organizationId:1});
  const bookingId=await seedBooking(db,{code:"RD-ADD-GUARD",doctor:doctorEmail}); await issueBase(db,doctor,bookingId); const {id}=await createAndIssueAddendum(db,doctor,manager,bookingId); const delivery=addendumDelivery(raw,id); assert.ok(delivery?.id>0);
  raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Addendum Org 2','addendum-org-2',1)");
  await assert.rejects(db.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id) VALUES (2,'result_delivery',?,CURRENT_TIMESTAMP,'posted','Видача виправлення до протоколу пацієнту','x@example.com','x@example.com',CURRENT_TIMESTAMP,?)`).bind(delivery.number,delivery.basisDocumentId).run(),/business_document_basis_tenant_mismatch|result_delivery_protocol_or_basis_mismatch/i);
  const org2=await seedStaffSession(db,{email:"add-org2@example.com",role:"registrar",organizationId:2}); const list=await journal(db,org2); const body=await list.json(); assert.equal(body.documents.some(x=>x.id===delivery.id),false); assert.equal((await journal(db,org2,delivery.id)).status,404);
 });
});

test("0094 contains no historical addendum-delivery backfill",async()=>{
 const {readFile}=await import("node:fs/promises"); const migration=await readFile(new URL("../drizzle/0094_result_addendum_delivery.sql",import.meta.url),"utf8");
 assert.match(migration,/AFTER UPDATE OF `status` ON `protocol_addenda`/); assert.match(migration,/OLD\.status='signed' AND NEW\.status='issued'/); assert.doesNotMatch(migration,/INSERT INTO `business_documents`[\s\S]*SELECT[\s\S]*FROM `protocol_addenda`[\s\S]*status='issued'/i);
});