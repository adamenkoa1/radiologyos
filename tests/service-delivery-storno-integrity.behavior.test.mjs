import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedCompleted(db,raw,{code="RD-STORNO-INT",amount=2600}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (1,?,'Integrity Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-22','10:00','civilian','pending',?,0,'confirmed',2,'integrity-doctor@example.com','integrity-tech@example.com')`
  ).bind(code,amount).run();
  const bookingId=Number(result.meta.last_row_id);
  await db.prepare(
    `UPDATE bookings SET performed_at='2026-08-22T10:05:00',status='completed' WHERE organization_id=1 AND id=?`
  ).bind(bookingId).run();
  const source=raw.prepare(
    `SELECT d.id,d.number FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=1 AND s.booking_id=? AND d.document_type='service_delivery'`
  ).get(bookingId);
  return {bookingId,sourceDocumentId:source.id,sourceNumber:source.number};
}

async function storno(db,cookie,sourceDocumentId,reason="Корекція для перевірки цілісності") {
  return callWorker(jsonRequest("/api/staff/service-deliveries/corrections",{sourceDocumentId,reason},{headers:{cookie}}),db);
}

function createExactDraftCorrection(raw,sourceDocumentId) {
  const created=raw.prepare(
    `INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by,reversed_document_id)
     VALUES (1,'service_delivery','СТ-FORGE',CURRENT_TIMESTAMP,'draft','forged draft','attacker@example.com',?)`
  ).run(sourceDocumentId);
  const documentId=Number(created.lastInsertRowid);
  raw.prepare(
    `INSERT INTO service_correction_details
      (organization_id,document_id,source_document_id,booking_id,correction_kind,reason,patient_id,patient_category,
       service_code,service_title,equipment_id,duration_minutes,anatomical_regions_count,performed_at,
       radiologist_email,radiographer_email,charge_amount,currency)
     SELECT 1,?,?,s.booking_id,'storno','Шахрайська корекція',s.patient_id,s.patient_category,
            s.service_code,s.service_title,s.equipment_id,s.duration_minutes,s.anatomical_regions_count,s.performed_at,
            s.radiologist_email,s.radiographer_email,s.charge_amount,s.currency
     FROM service_delivery_details s WHERE s.organization_id=1 AND s.document_id=?`
  ).run(documentId,sourceDocumentId,sourceDocumentId);
  return documentId;
}

test("D1 refuses to reverse a posted service without an exact draft correction document",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-STORNO-NO-DOC"});
    assert.throws(()=>raw.prepare(
      "UPDATE business_documents SET state='reversed' WHERE organization_id=1 AND id=?"
    ).run(seeded.sourceDocumentId),/service_delivery_reversal_requires_correction/);
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(seeded.sourceDocumentId).state,"posted");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM service_correction_details WHERE organization_id=1").get().n,0);
  });
});

test("a correction document cannot be manually posted while its source is still posted",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-STORNO-MANUAL-POST"});
    const correctionId=createExactDraftCorrection(raw,seeded.sourceDocumentId);
    assert.throws(()=>raw.prepare(
      "UPDATE business_documents SET state='posted' WHERE organization_id=1 AND id=?"
    ).run(correctionId),/service_correction_requires_reversed_source/);
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(correctionId).state,"draft");
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(seeded.sourceDocumentId).state,"posted");
  });
});

test("a register failure rolls back source reversal and correction posting atomically",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-STORNO-ROLLBACK",amount:2800});
    const cookie=await seedStaffSession(db,{email:"storno-rollback@example.com",role:"registrar",organizationId:1});
    raw.exec(`CREATE TRIGGER test_abort_service_storno_revenue
      BEFORE INSERT ON revenue_movements
      WHEN NEW.movement_type='service_correction'
      BEGIN SELECT RAISE(ABORT,'test_storno_register_failure'); END;`);

    const response=await storno(db,cookie,seeded.sourceDocumentId,"Сторно має повністю відкотитися");
    assert.equal(response.status,500);
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(seeded.sourceDocumentId).state,"posted");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM service_correction_details WHERE organization_id=1 AND source_document_id=?").get(seeded.sourceDocumentId).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM service_correction_movements WHERE organization_id=1 AND source_document_id=?").get(seeded.sourceDocumentId).n,0);
    assert.equal(raw.prepare("SELECT SUM(amount_delta) AS total FROM revenue_movements WHERE organization_id=1 AND booking_id=?").get(seeded.bookingId).total,2800);
    assert.equal(raw.prepare("SELECT SUM(minutes_delta) AS total FROM equipment_load_movements WHERE organization_id=1 AND booking_id=?").get(seeded.bookingId).total,30);
  });
});

test("explicit service posting returns 409 after storno instead of recreating the same performed fact",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-STORNO-REPOST"});
    const cookie=await seedStaffSession(db,{email:"storno-repost@example.com",role:"registrar",organizationId:1});
    const reversed=await storno(db,cookie,seeded.sourceDocumentId,"Сторно перед перевіркою повторного проведення");
    assert.equal(reversed.status,201);

    const repost=await callWorker(jsonRequest("/api/staff/service-deliveries",{
      bookingId:seeded.bookingId,
    },{headers:{cookie}}),db);
    assert.equal(repost.status,409);
    const body=await repost.json();
    assert.match(body.error,/сторновано/i);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM service_delivery_details WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId).n,1);
  });
});
