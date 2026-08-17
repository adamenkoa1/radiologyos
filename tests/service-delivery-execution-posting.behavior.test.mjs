import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-SVC-AUTO",category="civilian",amount=2500}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (1,?,'Auto Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-20','10:00',?,'pending',?,0,'confirmed',2,'doctor@example.com','tech@example.com')`
  ).bind(code,category,amount).run();
  return Number(result.meta.last_row_id);
}

function performanceFor(raw,sourceDocumentId) {
  return raw.prepare(
    `SELECT id,state,basis_document_id AS basisDocumentId
     FROM business_documents
     WHERE organization_id=1 AND document_type='study_performance' AND basis_document_id=?
     LIMIT 1`
  ).get(sourceDocumentId);
}

test("marking a study completed atomically posts economic and operational registrar documents",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    await db.prepare(
      `UPDATE bookings SET performed_at='2026-08-20T10:05:00',status='completed'
       WHERE organization_id=1 AND id=?`
    ).bind(bookingId).run();

    const doc=raw.prepare(
      `SELECT d.id,d.number,d.state,s.charge_amount AS chargeAmount
       FROM business_documents d
       JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
       WHERE d.organization_id=1 AND s.booking_id=? AND d.document_type='service_delivery'`
    ).get(bookingId);
    assert.ok(doc?.id>0);
    assert.equal(doc.number,`НП-${String(doc.id).padStart(6,"0")}`);
    assert.equal(doc.state,"posted");
    assert.equal(doc.chargeAmount,2500);

    const performance=performanceFor(raw,doc.id);
    assert.ok(performance?.id>0);
    assert.equal(performance.state,"posted");
    assert.equal(performance.basisDocumentId,doc.id);

    assert.equal(raw.prepare("SELECT amount_delta FROM revenue_movements WHERE document_id=?").get(doc.id).amount_delta,2500);
    assert.equal(raw.prepare("SELECT amount_delta FROM patient_settlement_movements WHERE document_id=?").get(doc.id).amount_delta,2500);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM services_delivered_movements WHERE document_id=?").get(doc.id).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM equipment_load_movements WHERE document_id=?").get(doc.id).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_output_movements WHERE document_id=?").get(doc.id).n,0);

    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM services_delivered_movements WHERE document_id=?").get(performance.id).n,1);
    assert.equal(raw.prepare("SELECT minutes_delta FROM equipment_load_movements WHERE document_id=?").get(performance.id).minutes_delta,30);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_output_movements WHERE document_id=?").get(performance.id).n,2);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM revenue_movements WHERE document_id=?").get(performance.id).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM patient_settlement_movements WHERE document_id=?").get(performance.id).n,0);
  });
});

test("posted service delivery freezes the booking facts that define revenue and output",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-SVC-FREEZE"});
    await db.prepare(
      `UPDATE bookings SET performed_at='2026-08-20T10:05:00',status='completed'
       WHERE organization_id=1 AND id=?`
    ).bind(bookingId).run();

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET payment_amount=1 WHERE organization_id=1 AND id=?"
    ).run(bookingId),/service_delivery_booking_immutable/);
    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET assigned_radiologist_email='other@example.com' WHERE organization_id=1 AND id=?"
    ).run(bookingId),/service_delivery_booking_immutable/);
    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET performed_at='2026-08-20T11:00:00' WHERE organization_id=1 AND id=?"
    ).run(bookingId),/service_delivery_booking_immutable/);

    const facts=raw.prepare(
      "SELECT payment_amount,assigned_radiologist_email,performed_at FROM bookings WHERE id=?"
    ).get(bookingId);
    assert.equal(facts.payment_amount,2500);
    assert.equal(facts.assigned_radiologist_email,"doctor@example.com");
    assert.equal(facts.performed_at,"2026-08-20T10:05:00");
  });
});

test("military completion auto-posts study-performance output without revenue or patient charge",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-SVC-AUTO-MIL",category:"military",amount:2500});
    await db.prepare(
      `UPDATE bookings SET performed_at='2026-08-20T10:05:00',status='completed'
       WHERE organization_id=1 AND id=?`
    ).bind(bookingId).run();
    const doc=raw.prepare(
      `SELECT d.id,s.charge_amount AS chargeAmount
       FROM business_documents d JOIN service_delivery_details s ON s.document_id=d.id
       WHERE s.booking_id=? AND d.document_type='service_delivery'`
    ).get(bookingId);
    const performance=performanceFor(raw,doc.id);
    assert.ok(performance?.id>0);
    assert.equal(doc.chargeAmount,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM services_delivered_movements WHERE document_id=?").get(performance.id).n,1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM equipment_load_movements WHERE document_id=?").get(performance.id).n,1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_output_movements WHERE document_id=?").get(performance.id).n,2);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM revenue_movements WHERE document_id=?").get(doc.id).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM patient_settlement_movements WHERE document_id=?").get(doc.id).n,0);
  });
});
