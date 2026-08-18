import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code,doctor,organizationId=1,name="Delivery Patient"}) {
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email,performed_at)
    VALUES (?,?,?,'+380501110099','380501110099','1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-09-26','10:00','civilian','pending',2500,0,'completed',2,?,'delivery-tech@example.com','2026-09-26T10:05:00')`)
    .bind(organizationId,code,name,doctor).run();
  return Number(result.meta.last_row_id);
}

function protocolPayload(bookingId,baseVersion,status){return {
  bookingId,baseVersion,status,templateKey:"generic",method:"КТ без контрастування",sections:{},
  findings:"SECRET FINDINGS",conclusion:"SECRET CONCLUSION",recommendations:"SECRET RECOMMENDATIONS",
  number:`P-DEL-${bookingId}`,
};}
async function putProtocol(db,cookie,payload){return callWorker(jsonRequest("/api/staff/protocols",payload,{method:"PUT",headers:{cookie}}),db);}
async function signProtocol(db,doctor,bookingId){
  let r=await putProtocol(db,doctor,protocolPayload(bookingId,0,"ready")); assert.equal(r.status,200); let b=await r.json();
  r=await putProtocol(db,doctor,protocolPayload(bookingId,b.version,"signed")); assert.equal(r.status,200); b=await r.json();
  return b;
}
async function deliveryList(db,cookie){return callWorker(new Request("http://localhost/api/staff/result-deliveries",{headers:{cookie}}),db);}
async function deliver(db,cookie,body){return callWorker(jsonRequest("/api/staff/result-deliveries",body,{method:"POST",headers:{cookie}}),db);}
async function createSignedAddendum(db,doctor,bookingId){
  let r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{bookingId,reason:"SECRET REASON",correctionText:"SECRET CORRECTION TEXT"},{method:"POST",headers:{cookie:doctor}}),db);
  assert.equal(r.status,201); let b=await r.json(); const id=b.addendum.id;
  r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{id,baseVersion:1,reason:"SECRET REASON",correctionText:"SECRET CORRECTION TEXT",status:"ready"},{method:"PUT",headers:{cookie:doctor}}),db);
  assert.equal(r.status,200); b=await r.json();
  r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{id,baseVersion:b.addendum.version,reason:"SECRET REASON",correctionText:"SECRET CORRECTION TEXT",status:"signed"},{method:"PUT",headers:{cookie:doctor}}),db);
  assert.equal(r.status,200); b=await r.json();
  return b.addendum;
}
function baseDelivery(raw,bookingId){return raw.prepare(`SELECT d.id,r.signed_by AS signedBy,r.delivered_by AS deliveredBy FROM result_delivery_details r JOIN business_documents d ON d.id=r.document_id AND d.organization_id=r.organization_id WHERE r.organization_id=1 AND r.booking_id=? LIMIT 1`).get(bookingId);}
function addendumDelivery(raw,id){return raw.prepare(`SELECT d.id,r.signed_by AS signedBy,r.delivered_by AS deliveredBy FROM result_addendum_delivery_details r JOIN business_documents d ON d.id=r.document_id AND d.organization_id=r.organization_id WHERE r.organization_id=1 AND r.addendum_id=? LIMIT 1`).get(id);}
function movementCount(raw,table,documentId){return Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id=?`).get(documentId).n);}

test("registrar lists metadata-only signed result and delivers it without clinical protocol access",async()=>{
  await withD1(async(db,raw)=>{
    const doctorEmail="delivery-doctor@example.com";
    const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1});
    const registrarEmail="delivery-registrar@example.com";
    const registrar=await seedStaffSession(db,{email:registrarEmail,role:"registrar",organizationId:1});
    const bookingId=await seedBooking(db,{code:"RD-260926-1",doctor:doctorEmail});
    const signed=await signProtocol(db,doctor,bookingId);

    const listResponse=await deliveryList(db,registrar); assert.equal(listResponse.status,200);
    const list=await listResponse.json();
    const pending=list.pending.find(x=>x.kind==="protocol"&&x.bookingId===bookingId);
    assert.ok(pending); assert.equal(pending.version,signed.version); assert.equal(pending.signedBy,doctorEmail);
    const serialized=JSON.stringify(list);
    assert.doesNotMatch(serialized,/SECRET FINDINGS|SECRET CONCLUSION|SECRET RECOMMENDATIONS|findings|conclusion|sections/i);

    const clinical=await callWorker(new Request(`http://localhost/api/staff/protocols?bookingId=${bookingId}`,{headers:{cookie:registrar}}),db);
    assert.equal(clinical.status,403);

    const issued=await deliver(db,registrar,{kind:"protocol",bookingId,version:signed.version});
    assert.equal(issued.status,200); const issuedBody=await issued.json(); assert.equal(issuedBody.ok,true);
    const evidence=baseDelivery(raw,bookingId); assert.ok(evidence?.id>0); assert.equal(evidence.signedBy,doctorEmail); assert.equal(evidence.deliveredBy,registrarEmail);
    assert.equal(raw.prepare("SELECT status FROM protocols WHERE organization_id=1 AND booking_id=?").get(bookingId).status,"issued");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM result_delivery_details WHERE organization_id=1 AND booking_id=?").get(bookingId).n,1);
    for(const table of ["cash_movements","patient_settlement_movements","revenue_movements","services_delivered_movements","service_correction_movements","equipment_load_movements","staff_output_movements","inventory_movements"]) assert.equal(movementCount(raw,table,evidence.id),0);

    const duplicate=await deliver(db,registrar,{kind:"protocol",bookingId,version:signed.version});
    assert.equal(duplicate.status,409);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM result_delivery_details WHERE organization_id=1 AND booking_id=?").get(bookingId).n,1);
  });
});

test("registrar delivers signed addendum while correction text remains clinically restricted",async()=>{
  await withD1(async(db,raw)=>{
    const doctorEmail="addendum-delivery-doctor@example.com";
    const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1});
    const registrarEmail="addendum-delivery-registrar@example.com";
    const registrar=await seedStaffSession(db,{email:registrarEmail,role:"registrar",organizationId:1});
    const bookingId=await seedBooking(db,{code:"RD-260926-2",doctor:doctorEmail});
    const signedBase=await signProtocol(db,doctor,bookingId);
    assert.equal((await deliver(db,registrar,{kind:"protocol",bookingId,version:signedBase.version})).status,200);
    const addendum=await createSignedAddendum(db,doctor,bookingId);

    const listResponse=await deliveryList(db,registrar); assert.equal(listResponse.status,200); const list=await listResponse.json();
    const pending=list.pending.find(x=>x.kind==="addendum"&&x.addendumId===addendum.id);
    assert.ok(pending); assert.equal(pending.bookingId,bookingId); assert.equal(pending.version,addendum.version); assert.equal(pending.signedBy,doctorEmail);
    assert.doesNotMatch(JSON.stringify(list),/SECRET REASON|SECRET CORRECTION TEXT|correctionText|reason/i);

    const clinical=await callWorker(new Request(`http://localhost/api/staff/protocols/addenda?bookingId=${bookingId}`,{headers:{cookie:registrar}}),db);
    assert.equal(clinical.status,403);

    const issued=await deliver(db,registrar,{kind:"addendum",addendumId:addendum.id,version:addendum.version});
    assert.equal(issued.status,200);
    const evidence=addendumDelivery(raw,addendum.id); assert.ok(evidence?.id>0); assert.equal(evidence.signedBy,doctorEmail); assert.equal(evidence.deliveredBy,registrarEmail);
    assert.equal(raw.prepare("SELECT status FROM protocol_addenda WHERE organization_id=1 AND id=?").get(addendum.id).status,"issued");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM result_addendum_delivery_details WHERE organization_id=1 AND addendum_id=?").get(addendum.id).n,1);
  });
});

test("delivery role, assignment, stale-version and tenant boundaries fail closed",async()=>{
  await withD1(async(db,raw)=>{
    const doctor1Email="scope-doctor-1@example.com",doctor2Email="scope-doctor-2@example.com";
    const doctor1=await seedStaffSession(db,{email:doctor1Email,role:"radiologist",organizationId:1});
    const doctor2=await seedStaffSession(db,{email:doctor2Email,role:"radiologist",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"scope-reg@example.com",role:"registrar",organizationId:1});
    const radiographer=await seedStaffSession(db,{email:"scope-tech@example.com",role:"radiographer",organizationId:1});
    const ownId=await seedBooking(db,{code:"RD-260926-3",doctor:doctor1Email,name:"Own Delivery Patient"});
    const foreignId=await seedBooking(db,{code:"RD-260926-4",doctor:doctor2Email,name:"Other Delivery Patient"});
    const ownSigned=await signProtocol(db,doctor1,ownId); const foreignSigned=await signProtocol(db,doctor2,foreignId);

    assert.equal((await deliveryList(db,radiographer)).status,403);
    assert.equal((await deliver(db,radiographer,{kind:"protocol",bookingId:ownId,version:ownSigned.version})).status,403);

    const doctorList=await deliveryList(db,doctor1); assert.equal(doctorList.status,200); const doctorBody=await doctorList.json();
    assert.equal(doctorBody.pending.some(x=>x.bookingId===ownId),true);
    assert.equal(doctorBody.pending.some(x=>x.bookingId===foreignId),false);
    assert.equal((await deliver(db,doctor1,{kind:"protocol",bookingId:foreignId,version:foreignSigned.version})).status,404);

    const stale=await deliver(db,registrar,{kind:"protocol",bookingId:ownId,version:ownSigned.version+1});
    assert.equal(stale.status,409); assert.equal(baseDelivery(raw,ownId),undefined);

    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Delivery Org 2','delivery-org-2',1)");
    const org2DoctorEmail="org2-delivery-doctor@example.com";
    const org2Doctor=await seedStaffSession(db,{email:org2DoctorEmail,role:"radiologist",organizationId:2});
    const org2Booking=await seedBooking(db,{code:"RD-260926-5",doctor:org2DoctorEmail,organizationId:2,name:"Org2 Secret Patient"});
    const org2Signed=await signProtocol(db,org2Doctor,org2Booking);
    const org1List=await deliveryList(db,registrar); const org1Body=await org1List.json();
    assert.equal(org1Body.pending.some(x=>x.bookingId===org2Booking),false);
    assert.equal((await deliver(db,registrar,{kind:"protocol",bookingId:org2Booking,version:org2Signed.version})).status,404);
  });
});
