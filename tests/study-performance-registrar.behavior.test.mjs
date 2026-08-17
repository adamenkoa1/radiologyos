import assert from "node:assert/strict";
import test from "node:test";
import { postServiceDelivery } from "../lib/service-deliveries.ts";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{
  organizationId=1,
  code="RD-PERF-001",
  category="civilian",
  amount=2500,
  status="confirmed",
  performedAt="",
}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,performed_at,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,'Performance Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-22','10:00',?,'pending',?,0,?,?,2,'performance-doctor@example.com','performance-tech@example.com')`
  ).bind(organizationId,code,category,amount,status,performedAt).run();
  return Number(result.meta.last_row_id);
}

async function complete(db,organizationId,bookingId,performedAt="2026-08-22T10:05:00") {
  await db.prepare(
    "UPDATE bookings SET performed_at=?,status='completed' WHERE organization_id=? AND id=?"
  ).bind(performedAt,organizationId,bookingId).run();
}

function documents(raw,organizationId,bookingId) {
  const source=raw.prepare(
    `SELECT d.id,d.number,d.state,d.posted_by AS postedBy,d.posted_at AS postedAt,s.performed_at AS performedAt
     FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=? AND s.booking_id=? AND d.document_type='service_delivery'
     ORDER BY d.id DESC LIMIT 1`
  ).get(organizationId,bookingId);
  const performance=source ? raw.prepare(
    `SELECT id,number,state,basis_document_id AS basisDocumentId,occurred_at AS occurredAt,
            created_by AS createdBy,posted_by AS postedBy,posted_at AS postedAt
     FROM business_documents
     WHERE organization_id=? AND document_type='study_performance' AND basis_document_id=?
     ORDER BY id DESC LIMIT 1`
  ).get(organizationId,source.id) : null;
  return {source,performance};
}

function movementCounts(raw,documentId) {
  return {
    services:raw.prepare("SELECT COUNT(*) AS n FROM services_delivered_movements WHERE document_id=?").get(documentId).n,
    equipment:raw.prepare("SELECT COUNT(*) AS n FROM equipment_load_movements WHERE document_id=?").get(documentId).n,
    staff:raw.prepare("SELECT COUNT(*) AS n FROM staff_output_movements WHERE document_id=?").get(documentId).n,
    revenue:raw.prepare("SELECT COUNT(*) AS n FROM revenue_movements WHERE document_id=?").get(documentId).n,
    settlements:raw.prepare("SELECT COUNT(*) AS n FROM patient_settlement_movements WHERE document_id=?").get(documentId).n,
    cash:raw.prepare("SELECT COUNT(*) AS n FROM cash_movements WHERE document_id=?").get(documentId).n,
  };
}

function correctionForSource(raw,organizationId,sourceDocumentId) {
  return raw.prepare(
    `SELECT d.id,d.state,c.anatomical_regions_count AS regions,c.duration_minutes AS duration
     FROM business_documents d
     JOIN service_correction_details c ON c.document_id=d.id AND c.organization_id=d.organization_id
     WHERE d.organization_id=? AND c.source_document_id=? LIMIT 1`
  ).get(organizationId,sourceDocumentId);
}

test("automatic completion makes study-performance the positive operational owner",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    await complete(db,1,bookingId);

    const {source,performance}=documents(raw,1,bookingId);
    assert.ok(source?.id>0);
    assert.ok(performance?.id>0);
    assert.equal(performance.number,`ВД-${String(source.id).padStart(6,"0")}`);
    assert.equal(performance.state,"posted");
    assert.equal(performance.basisDocumentId,source.id);
    assert.equal(performance.occurredAt,source.performedAt);
    assert.equal(performance.createdBy,"system:execution");
    assert.equal(performance.postedBy,"system:execution");
    assert.equal(performance.postedAt,source.postedAt);

    assert.deepEqual(movementCounts(raw,performance.id),{
      services:1,equipment:1,staff:2,revenue:0,settlements:0,cash:0,
    });
    assert.deepEqual(movementCounts(raw,source.id),{
      services:0,equipment:0,staff:0,revenue:1,settlements:1,cash:0,
    });

    const serviceMovement=raw.prepare(
      "SELECT actor_email AS actor,occurred_at AS occurredAt FROM services_delivered_movements WHERE document_id=?"
    ).get(performance.id);
    assert.equal(serviceMovement.actor,performance.postedBy);
    assert.equal(serviceMovement.occurredAt,performance.occurredAt);
  });
});

test("explicit legacy posting follows the same split without inventing a historical backfill",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{
      code:"RD-PERF-LEGACY",status:"completed",performedAt:"2026-08-22T11:05:00",
    });

    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM business_documents WHERE organization_id=1 AND document_type='study_performance'"
    ).get().n,0,"inserting an already-completed historical booking must not backfill a performance document");

    const posted=await postServiceDelivery(db,{
      organizationId:1,bookingId,actorEmail:"legacy-registrar@example.com",
    });
    assert.equal(posted.created,true);

    const {source,performance}=documents(raw,1,bookingId);
    assert.equal(source.id,posted.document.id);
    assert.equal(performance.basisDocumentId,source.id);
    assert.equal(performance.state,"posted");
    assert.equal(performance.createdBy,"legacy-registrar@example.com");
    assert.equal(performance.postedBy,"legacy-registrar@example.com");
    assert.equal(performance.occurredAt,"2026-08-22T11:05:00");
    assert.deepEqual(movementCounts(raw,performance.id),{
      services:1,equipment:1,staff:2,revenue:0,settlements:0,cash:0,
    });
    assert.deepEqual(movementCounts(raw,source.id),{
      services:0,equipment:0,staff:0,revenue:1,settlements:1,cash:0,
    });
  });
});

test("military completion owns operational facts in study-performance without economic movements",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{
      code:"RD-PERF-MIL",category:"military",amount:5000,
    });
    await complete(db,1,bookingId,"2026-08-22T12:05:00");
    const {source,performance}=documents(raw,1,bookingId);
    assert.ok(source?.id>0 && performance?.id>0);
    assert.deepEqual(movementCounts(raw,performance.id),{
      services:1,equipment:1,staff:2,revenue:0,settlements:0,cash:0,
    });
    assert.deepEqual(movementCounts(raw,source.id),{
      services:0,equipment:0,staff:0,revenue:0,settlements:0,cash:0,
    });
  });
});

test("service storno reverses performance before appending operational corrections",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-PERF-STORNO"});
    await complete(db,1,bookingId);
    const before=documents(raw,1,bookingId);

    assert.throws(()=>raw.prepare(
      "UPDATE business_documents SET state='reversed' WHERE organization_id=1 AND id=?"
    ).run(before.performance.id),/study_performance_source_storno_required/);

    const cookie=await seedStaffSession(db,{
      email:"performance-storno@example.com",role:"registrar",organizationId:1,
    });
    const response=await callWorker(jsonRequest("/api/staff/service-deliveries/corrections",{
      sourceDocumentId:before.source.id,
      reason:"Сторно для перевірки документа виконання",
    },{headers:{cookie}}),db);
    assert.equal(response.status,201);

    const source=raw.prepare("SELECT state FROM business_documents WHERE id=?").get(before.source.id);
    const performance=raw.prepare("SELECT state FROM business_documents WHERE id=?").get(before.performance.id);
    const correction=correctionForSource(raw,1,before.source.id);
    assert.equal(source.state,"reversed");
    assert.equal(performance.state,"reversed");
    assert.equal(correction.state,"posted");

    // Positive history stays immutable on the reversed performance registrar.
    assert.deepEqual(movementCounts(raw,before.performance.id),{
      services:1,equipment:1,staff:2,revenue:0,settlements:0,cash:0,
    });
    // Economic history stays on service_delivery; the separate correction owns all negative entries.
    assert.deepEqual(movementCounts(raw,before.source.id),{
      services:0,equipment:0,staff:0,revenue:1,settlements:1,cash:0,
    });
    assert.deepEqual(movementCounts(raw,correction.id),{
      services:0,equipment:1,staff:2,revenue:1,settlements:1,cash:0,
    });
    const serviceCorrection=raw.prepare(
      `SELECT quantity_delta AS quantityDelta,anatomical_regions_delta AS regionsDelta
       FROM service_correction_movements WHERE document_id=?`
    ).get(correction.id);
    assert.deepEqual(serviceCorrection,{quantityDelta:-1,regionsDelta:-2});
    assert.equal(raw.prepare(
      "SELECT SUM(minutes_delta) AS n FROM equipment_load_movements WHERE document_id=?"
    ).get(correction.id).n,-30);
    assert.equal(raw.prepare(
      "SELECT SUM(units_delta) AS n FROM staff_output_movements WHERE document_id=?"
    ).get(correction.id).n,-2);
  });
});

test("D1 rejects positive operational movements owned by the economic source document",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-PERF-OWNER-GUARD"});
    await complete(db,1,bookingId);
    const {source,performance}=documents(raw,1,bookingId);
    assert.ok(source?.id>0 && performance?.id>0);

    const snapshot=raw.prepare(
      `SELECT booking_id AS bookingId,patient_id AS patientId,service_code AS serviceCode,equipment_id AS equipmentId,
              anatomical_regions_count AS regions,performed_at AS performedAt
       FROM service_delivery_details WHERE document_id=?`
    ).get(source.id);
    assert.throws(()=>raw.prepare(
      `INSERT INTO services_delivered_movements
       (organization_id,document_id,booking_id,patient_id,service_code,equipment_id,quantity,
        anatomical_regions_count,performed_at,actor_email,occurred_at)
       VALUES (1,?,?,?,?,?,1,?,?,?,?)`
    ).run(
      source.id,snapshot.bookingId,snapshot.patientId,snapshot.serviceCode,snapshot.equipmentId,
      snapshot.regions,snapshot.performedAt,source.postedBy,snapshot.performedAt,
    ),/services_delivered_performance_mismatch/);

    assert.throws(()=>raw.prepare(
      `INSERT INTO equipment_load_movements
       (organization_id,document_id,booking_id,equipment_id,minutes_delta,performed_at,actor_email,occurred_at)
       VALUES (1,?,?,?,?,?,?,?)`
    ).run(source.id,snapshot.bookingId,snapshot.equipmentId,30,snapshot.performedAt,source.postedBy,snapshot.performedAt),
      /equipment_load_document_mismatch/);
  });
});

test("D1 enforces one performance registrar per source and a service-delivery basis",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-PERF-GUARDS"});
    await complete(db,1,bookingId);
    const {source,performance}=documents(raw,1,bookingId);

    assert.throws(()=>raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id)
       VALUES (1,'study_performance',?,?,'posted','duplicate',?,?,?,?)`
    ).run(performance.number,performance.occurredAt,source.postedBy,source.postedBy,source.postedAt,source.id),
      /study_performance_source_already_registered/);

    const patientOrder=raw.prepare(
      `SELECT o.document_id AS id FROM patient_order_details o
       WHERE o.organization_id=1 AND o.booking_id=? LIMIT 1`
    ).get(bookingId);
    assert.ok(patientOrder?.id>0);
    assert.throws(()=>raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id)
       VALUES (1,'study_performance',?,'2026-08-22T10:05:00','posted','invalid basis','x','x','2026-08-22T10:05:00',?)`
    ).run(`ВД-${String(patientOrder.id).padStart(6,"0")}`,patientOrder.id),/study_performance_basis_invalid/);
  });
});

test("study-performance basis and operational ownership cannot cross tenant boundaries",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Performance Org 2','performance-org-2',1)");
    const bookingId=await seedBooking(db,{organizationId:2,code:"RD-PERF-ORG2",category:"military",amount:0});
    await complete(db,2,bookingId);
    const {source,performance}=documents(raw,2,bookingId);
    assert.ok(source?.id>0 && performance?.id>0);

    assert.throws(()=>raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id)
       VALUES (1,'study_performance',?,'2026-08-22T10:05:00','posted','cross tenant','x','x','2026-08-22T10:05:00',?)`
    ).run(`ВД-${String(source.id).padStart(6,"0")}`,source.id),
      /(business_document_basis_tenant_mismatch|study_performance_basis_invalid)/);

    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM business_documents WHERE organization_id=1 AND document_type='study_performance' AND basis_document_id=?"
    ).get(source.id).n,0);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM services_delivered_movements WHERE organization_id=1 AND document_id=?"
    ).get(performance.id).n,0);
  });
});
