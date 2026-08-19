import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{
  organizationId=1,
  code="RD-RESULT-001",
  status="confirmed",
  performedAt="",
  assignedRadiologistEmail="result-doctor@example.com",
}={}) {
  await db.prepare(
    `INSERT OR IGNORE INTO patient_profiles
      (patient_id,organization_id,phone_normalized,display_name,updated_by)
     VALUES ('PAT-RESULT-001',?,'380501112233','Result Patient','test:result-delivery')`
  ).bind(organizationId).run();
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,patient_id,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,performed_at,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,'Result Patient','+380501112233','380501112233','PAT-RESULT-001','КТ ОГК','ct-chest','ct',30,
       '2026-08-24','10:00','civilian','pending',2500,0,?,?,2,?,'result-tech@example.com')`
  ).bind(organizationId,code,status,performedAt,assignedRadiologistEmail).run();
  return Number(result.meta.last_row_id);
}

async function complete(db,bookingId,performedAt="2026-08-24T10:05:00") {
  await db.prepare(
    "UPDATE bookings SET performed_at=?,status='completed' WHERE organization_id=1 AND id=?"
  ).bind(performedAt,bookingId).run();
}

function protocolPayload(bookingId,baseVersion,status) {
  return {
    bookingId,baseVersion,status,
    templateKey:"generic",
    method:"КТ без внутрішньовенного контрастування",
    sections:{},
    findings:"Легенева тканина без свіжих вогнищевих змін.",
    conclusion:"КТ-ознаки без гострої патології.",
    recommendations:"Клінічна кореляція.",
    number:`CT-R-${bookingId}`,
  };
}

async function putProtocol(db,cookie,payload) {
  return callWorker(
    jsonRequest("/api/staff/protocols",payload,{method:"PUT",headers:{cookie}}),
    db,
  );
}

async function createSignedProtocol(db,cookie,bookingId) {
  const ready=await putProtocol(db,cookie,protocolPayload(bookingId,0,"ready"));
  assert.equal(ready.status,200);
  const readyBody=await ready.json();
  assert.equal(readyBody.version,1);
  const signed=await putProtocol(db,cookie,protocolPayload(bookingId,1,"signed"));
  assert.equal(signed.status,200);
  const signedBody=await signed.json();
  assert.equal(signedBody.version,2);
  assert.equal(signedBody.documentStatus,"signed");
  return signedBody;
}

async function issueProtocol(db,cookie,bookingId,baseVersion=2) {
  return putProtocol(db,cookie,protocolPayload(bookingId,baseVersion,"issued"));
}

function performanceForBooking(raw,bookingId) {
  return raw.prepare(
    `SELECT perf.id,perf.number,perf.state
     FROM business_documents perf
     JOIN business_documents src
       ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
     JOIN service_delivery_details s
       ON s.document_id=src.id AND s.organization_id=src.organization_id
     WHERE perf.organization_id=1 AND perf.document_type='study_performance'
       AND s.booking_id=?
     ORDER BY perf.id DESC LIMIT 1`
  ).get(bookingId);
}

function resultDelivery(raw,bookingId) {
  return raw.prepare(
    `SELECT d.id,d.number,d.state,d.basis_document_id AS basisDocumentId,
            d.occurred_at AS occurredAt,d.created_by AS createdBy,
            d.posted_by AS postedBy,d.posted_at AS postedAt,
            r.booking_id AS bookingId,r.patient_id AS patientId,r.service_title AS serviceTitle,
            r.protocol_number AS protocolNumber,r.protocol_version AS protocolVersion,
            r.signed_by AS signedBy,r.signed_at AS signedAt,
            r.delivered_by AS deliveredBy,r.delivered_at AS deliveredAt
     FROM business_documents d
     JOIN result_delivery_details r
       ON r.document_id=d.id AND r.organization_id=d.organization_id
     WHERE d.organization_id=1 AND r.booking_id=? AND d.document_type='result_delivery'
     LIMIT 1`
  ).get(bookingId);
}

async function journal(db,cookie,id=null) {
  const suffix=id?`?id=${id}`:"";
  return callWorker(new Request(`http://localhost/api/staff/business-documents${suffix}`,{
    headers:{cookie},
  }),db);
}

function movementCount(raw,table,documentId) {
  return Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id=?`).get(documentId).n);
}

test("signed protocol issuance atomically creates one posted result-delivery document based on study performance",async()=>{
  await withD1(async(db,raw)=>{
    const doctorEmail="result-doctor@example.com";
    const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"result-registrar@example.com",role:"registrar",organizationId:1});
    const bookingId=await seedBooking(db,{assignedRadiologistEmail:doctorEmail});
    await complete(db,bookingId);

    const performance=performanceForBooking(raw,bookingId);
    assert.ok(performance?.id>0);
    assert.equal(performance.state,"posted");

    const signed=await createSignedProtocol(db,doctor,bookingId);
    assert.equal(resultDelivery(raw,bookingId),undefined,"signing alone must not create delivery evidence");

    const issuedResponse=await issueProtocol(db,doctor,bookingId,signed.version);
    assert.equal(issuedResponse.status,200);
    const issued=await issuedResponse.json();
    assert.equal(issued.documentStatus,"issued");
    assert.equal(issued.version,signed.version,"delivery must not create a clinical revision");

    const delivery=resultDelivery(raw,bookingId);
    assert.ok(delivery?.id>0);
    assert.equal(delivery.number,`ВР-${String(bookingId).padStart(6,"0")}`);
    assert.equal(delivery.state,"posted");
    assert.equal(delivery.basisDocumentId,performance.id);
    assert.equal(delivery.bookingId,bookingId);
    assert.equal(delivery.patientId,"PAT-RESULT-001");
    assert.equal(delivery.serviceTitle,"КТ ОГК");
    assert.equal(delivery.protocolNumber,`CT-R-${bookingId}`);
    assert.equal(delivery.protocolVersion,signed.version);
    assert.equal(delivery.signedBy,doctorEmail);
    assert.equal(delivery.signedAt,signed.signedAt);
    assert.equal(delivery.createdBy,doctorEmail);
    assert.equal(delivery.postedBy,doctorEmail);
    assert.equal(delivery.deliveredBy,doctorEmail);
    assert.ok(delivery.deliveredAt);
    assert.equal(delivery.occurredAt,delivery.deliveredAt);
    assert.equal(delivery.postedAt,delivery.deliveredAt);

    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM result_delivery_details WHERE organization_id=1 AND booking_id=?"
    ).get(bookingId).n,1);

    for(const table of [
      "cash_movements","patient_settlement_movements","revenue_movements",
      "services_delivered_movements","service_correction_movements",
      "equipment_load_movements","staff_output_movements","inventory_movements",
    ]) assert.equal(movementCount(raw,table,delivery.id),0,`${table} must have no result-delivery movement`);

    const listResponse=await journal(db,registrar);
    assert.equal(listResponse.status,200);
    const list=await listResponse.json();
    const row=list.documents.find(item=>item.id===delivery.id);
    assert.equal(row.journalType,"result_delivery");
    assert.equal(row.bookingId,bookingId);
    assert.equal(row.bookingCode,"RD-RESULT-001");
    assert.equal(row.patientName,"Result Patient");
    assert.equal(row.patientId,"PAT-RESULT-001");
    assert.equal(row.subject,"КТ ОГК");
    assert.equal(row.amount,0);
    assert.equal(row.sourceDocumentId,performance.id);
    assert.equal(row.relationType,"based_on");

    const detailResponse=await journal(db,registrar,delivery.id);
    assert.equal(detailResponse.status,200);
    const detail=await detailResponse.json();
    assert.ok(detail.relations.parent.some(item=>item.id===performance.id && item.relationType==="based_on"));
    for(const movements of Object.values(detail.movements)) assert.equal(movements.length,0);

    await assert.rejects(
      db.prepare("UPDATE result_delivery_details SET service_title='tampered' WHERE document_id=?")
        .bind(delivery.id).run(),
      /result_delivery_snapshot_immutable/i,
    );
    await assert.rejects(
      db.prepare("DELETE FROM result_delivery_details WHERE document_id=?").bind(delivery.id).run(),
      /result_delivery_snapshot_immutable/i,
    );
    await assert.rejects(
      db.prepare("UPDATE business_documents SET state='reversed' WHERE id=?").bind(delivery.id).run(),
      /result_delivery_document_immutable/i,
    );

    await assert.rejects(
      db.prepare(
        `INSERT INTO business_documents
          (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id)
         VALUES (1,'result_delivery',?,CURRENT_TIMESTAMP,'posted','Видача результату пацієнту',?,?,CURRENT_TIMESTAMP,?)`
      ).bind(delivery.number,doctorEmail,doctorEmail,performance.id).run(),
      /UNIQUE constraint failed/i,
    );
  });
});

test("legacy completed booking without study-performance can still be issued with a null delivery basis",async()=>{
  await withD1(async(db,raw)=>{
    const doctorEmail="legacy-result-doctor@example.com";
    const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1});
    const bookingId=await seedBooking(db,{
      code:"RD-RESULT-LEGACY",
      status:"completed",
      performedAt:"2026-08-24T11:05:00",
      assignedRadiologistEmail:doctorEmail,
    });
    assert.equal(performanceForBooking(raw,bookingId),undefined);

    const signed=await createSignedProtocol(db,doctor,bookingId);
    const issuedResponse=await issueProtocol(db,doctor,bookingId,signed.version);
    assert.equal(issuedResponse.status,200);

    const delivery=resultDelivery(raw,bookingId);
    assert.ok(delivery?.id>0);
    assert.equal(delivery.basisDocumentId,null);
    assert.equal(delivery.bookingId,bookingId);
    assert.equal(delivery.protocolVersion,signed.version);
  });
});

test("D1 requires signed-to-issued transition and rejects cross-tenant result-delivery evidence",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-RESULT-D1"});

    await assert.rejects(
      db.prepare(
        `INSERT INTO protocols
          (organization_id,booking_id,template_key,method,findings,conclusion,number,status,version,
           author_email,updated_by,signed_by,signed_at,signed_version)
         VALUES (1,?,'generic','Method','Findings','Conclusion','DIRECT-ISSUED','issued',1,
           'doctor@example.com','doctor@example.com','doctor@example.com',CURRENT_TIMESTAMP,1)`
      ).bind(bookingId).run(),
      /protocol must start draft or ready|protocol_issue_requires_signed_transition/i,
    );

    await db.prepare(
      `INSERT INTO protocols
        (organization_id,booking_id,template_key,method,findings,conclusion,number,status,version,
         author_email,updated_by)
       VALUES (1,?,'generic','Method','Findings','Conclusion','READY-D1','ready',1,
         'doctor@example.com','doctor@example.com')`
    ).bind(bookingId).run();

    await assert.rejects(
      db.prepare(
        `UPDATE protocols SET status='issued',version=2,signed_by='doctor@example.com',
          signed_at=CURRENT_TIMESTAMP,signed_version=2
         WHERE organization_id=1 AND booking_id=?`
      ).bind(bookingId).run(),
      /protocol status transition invalid|protocol_issue_requires_signed_transition|signed protocol/i,
    );

    await db.prepare(
      `UPDATE protocols SET status='signed',version=2,signed_by='doctor@example.com',
        signed_at=CURRENT_TIMESTAMP,signed_version=2,updated_by='doctor@example.com'
       WHERE organization_id=1 AND booking_id=?`
    ).bind(bookingId).run();
    await db.prepare(
      "UPDATE protocols SET status='issued',updated_by='issuer@example.com',updated_at=CURRENT_TIMESTAMP WHERE organization_id=1 AND booking_id=?"
    ).bind(bookingId).run();
    const delivery=resultDelivery(raw,bookingId);
    assert.ok(delivery?.id>0);
    assert.equal(delivery.deliveredBy,"issuer@example.com");

    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Result Org 2','result-org-2',1)");
    await assert.rejects(
      db.prepare(
        `INSERT INTO business_documents
          (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id)
         VALUES (2,'result_delivery',?,CURRENT_TIMESTAMP,'posted','Видача результату пацієнту',
           'org2@example.com','org2@example.com',CURRENT_TIMESTAMP,?)`
      ).bind(delivery.number,delivery.basisDocumentId).run(),
      /business_document_basis_tenant_mismatch|result_delivery_protocol_or_basis_mismatch/i,
    );

    const org2=await seedStaffSession(db,{email:"result-org2@example.com",role:"registrar",organizationId:2});
    const listResponse=await journal(db,org2);
    assert.equal(listResponse.status,200);
    const list=await listResponse.json();
    assert.equal(list.documents.some(item=>item.id===delivery.id),false);
    const detailResponse=await journal(db,org2,delivery.id);
    assert.equal(detailResponse.status,404);
  });
});

test("0092 contains no historical result-delivery backfill",async()=>{
  const {readFile}=await import("node:fs/promises");
  const migration=await readFile(new URL("../drizzle/0092_result_delivery_registrar.sql",import.meta.url),"utf8");
  assert.match(migration,/AFTER UPDATE OF `status` ON `protocols`/);
  assert.match(migration,/OLD\.status='signed' AND NEW\.status='issued'/);
  assert.doesNotMatch(migration,/INSERT INTO `business_documents`[\s\S]*SELECT[\s\S]*FROM `protocols`[\s\S]*status='issued'/i);
});
