import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-EXEC-APT-1",patientId="PAT-EXEC-APT-1",phone="380501235001",time="10:00"}={}){
  await db.prepare(`INSERT OR IGNORE INTO patient_profiles
    (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES (?,1,?,'Execution Patient','execution-lineage-test')`).bind(patientId,phone).run();
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (1,?,'Execution Patient',?,?,?,'1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-10-03',?,'civilian','pending',2500,0,'confirmed',1,'exec-doctor@example.com','exec-tech@example.com')`)
    .bind(code,`+${phone}`,phone,patientId,time).run();
  return Number(result.meta.last_row_id);
}

function orderFor(raw,bookingId){
  return raw.prepare(`SELECT d.id,d.state FROM patient_order_details o
    JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
    WHERE o.organization_id=1 AND o.booking_id=? LIMIT 1`).get(bookingId);
}

function appointments(raw,bookingId){
  return raw.prepare(`SELECT d.id,d.state,d.basis_document_id AS basisDocumentId,a.appointment_version AS version
    FROM appointment_details a JOIN business_documents d ON d.id=a.document_id AND d.organization_id=a.organization_id
    WHERE a.organization_id=1 AND a.booking_id=? ORDER BY a.appointment_version`).all(bookingId);
}

function serviceFor(raw,bookingId){
  return raw.prepare(`SELECT d.id,d.state,d.basis_document_id AS basisDocumentId
    FROM service_delivery_details s JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
    WHERE s.organization_id=1 AND s.booking_id=? AND d.document_type='service_delivery' AND d.reversed_document_id IS NULL
    ORDER BY d.id DESC LIMIT 1`).get(bookingId);
}

function performanceFor(raw,serviceId){
  return raw.prepare(`SELECT id,state,basis_document_id AS basisDocumentId FROM business_documents
    WHERE organization_id=1 AND document_type='study_performance' AND basis_document_id=? LIMIT 1`).get(serviceId);
}

test("new execution is based on the exact latest posted Appointment and performance remains based on service delivery",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    const order=orderFor(raw,bookingId); assert.ok(order?.id>0);
    const v1=appointments(raw,bookingId)[0]; assert.equal(v1.state,"posted");

    await db.prepare("UPDATE bookings SET desired_time='11:15' WHERE organization_id=1 AND id=?").bind(bookingId).run();
    const beforeExecution=appointments(raw,bookingId);
    assert.equal(beforeExecution.length,2);
    assert.equal(beforeExecution[0].state,"reversed");
    assert.equal(beforeExecution[1].state,"posted");
    assert.equal(beforeExecution[1].basisDocumentId,v1.id);

    await db.prepare("UPDATE bookings SET performed_at='2026-10-03T11:20:00',status='completed' WHERE organization_id=1 AND id=?").bind(bookingId).run();
    const service=serviceFor(raw,bookingId); assert.equal(service.state,"posted");
    assert.equal(service.basisDocumentId,beforeExecution[1].id);
    assert.notEqual(service.basisDocumentId,order.id);

    const performance=performanceFor(raw,service.id); assert.ok(performance?.id>0);
    assert.equal(performance.state,"posted");
    assert.equal(performance.basisDocumentId,service.id);
  });
});

test("same-tenant Appointment from another booking cannot be forged as execution basis",async()=>{
  await withD1(async(db,raw)=>{
    const first=await seedBooking(db,{code:"RD-EXEC-FORGE-1",patientId:"PAT-EXEC-FORGE-1",phone:"380501235011",time:"10:00"});
    const second=await seedBooking(db,{code:"RD-EXEC-FORGE-2",patientId:"PAT-EXEC-FORGE-2",phone:"380501235012",time:"10:30"});
    const wrongAppointment=appointments(raw,second)[0];

    raw.exec("DROP TRIGGER booking_service_delivery_auto_post");
    raw.prepare("UPDATE bookings SET performed_at='2026-10-03T10:05:00',status='completed' WHERE organization_id=1 AND id=?").run(first);
    const b=raw.prepare("SELECT * FROM bookings WHERE organization_id=1 AND id=?").get(first);

    const created=raw.prepare(`INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by,basis_document_id)
      VALUES (1,'service_delivery','НП-FORGE',?,'draft','forged execution','attacker@example.com',?)`)
      .run(b.performed_at,wrongAppointment.id);
    const documentId=Number(created.lastInsertRowid);

    assert.throws(()=>raw.prepare(`INSERT INTO service_delivery_details
      (organization_id,document_id,booking_id,patient_id,patient_category,service_code,service_title,equipment_id,
       duration_minutes,anatomical_regions_count,performed_at,radiologist_email,radiographer_email,
       price_amount,charge_amount,currency)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'UAH')`)
      .run(documentId,first,b.patient_id,b.patient_category,b.service_code,b.service,b.equipment_id,
        b.duration_minutes,b.anatomical_regions_count,b.performed_at,b.assigned_radiologist_email,
        b.assigned_radiographer_email,b.payment_amount,b.payment_amount),/service_delivery_appointment_basis_mismatch/);
  });
});

test("pre-0095 style booking without Appointment history keeps Patient Order as execution basis",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("DROP TRIGGER patient_order_appointment_auto_create");
    const bookingId=await seedBooking(db,{code:"RD-EXEC-PRE0095",patientId:"PAT-EXEC-PRE0095",phone:"380501235021",time:"12:00"});
    const order=orderFor(raw,bookingId); assert.ok(order?.id>0);
    assert.equal(appointments(raw,bookingId).length,0);

    await db.prepare("UPDATE bookings SET performed_at='2026-10-03T12:05:00',status='completed' WHERE organization_id=1 AND id=?").bind(bookingId).run();
    const service=serviceFor(raw,bookingId); assert.equal(service.state,"posted");
    assert.equal(service.basisDocumentId,order.id);
  });
});

test("executed scheduling parent cannot be replaced by a retrospective date or time edit",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-EXEC-SCHEDULE-FREEZE",patientId:"PAT-EXEC-SCHEDULE-FREEZE",phone:"380501235031",time:"13:00"});
    await db.prepare("UPDATE bookings SET performed_at='2026-10-03T13:05:00',status='completed' WHERE organization_id=1 AND id=?").bind(bookingId).run();
    const before=appointments(raw,bookingId); assert.equal(before.length,1); assert.equal(before[0].state,"posted");
    const service=serviceFor(raw,bookingId); assert.equal(service.basisDocumentId,before[0].id);

    assert.throws(()=>raw.prepare("UPDATE bookings SET desired_time='14:00' WHERE organization_id=1 AND id=?").run(bookingId),/service_delivery_schedule_immutable/);
    assert.throws(()=>raw.prepare("UPDATE bookings SET desired_date='2026-10-04' WHERE organization_id=1 AND id=?").run(bookingId),/service_delivery_schedule_immutable/);
    const after=appointments(raw,bookingId);
    assert.deepEqual(after,before);
    assert.equal(serviceFor(raw,bookingId).basisDocumentId,before[0].id);
  });
});
