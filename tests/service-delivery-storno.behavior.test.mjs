import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedCompleted(db,raw,{code="RD-STORNO-001",amount=2500,category="civilian",organizationId=1}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,'Storno Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-21','10:00',?,'pending',?,0,'confirmed',2,'storno-doctor@example.com','storno-tech@example.com')`
  ).bind(organizationId,code,category,amount).run();
  const bookingId=Number(result.meta.last_row_id);
  await db.prepare(
    `UPDATE bookings SET performed_at='2026-08-21T10:05:00',status='completed'
     WHERE organization_id=? AND id=?`
  ).bind(organizationId,bookingId).run();
  const source=raw.prepare(
    `SELECT d.id,d.number FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=? AND s.booking_id=? AND d.document_type='service_delivery'`
  ).get(organizationId,bookingId);
  return {bookingId,sourceDocumentId:source.id,sourceNumber:source.number};
}

async function storno(db,cookie,sourceDocumentId,reason="Помилково виконане нарахування") {
  return callWorker(jsonRequest("/api/staff/service-deliveries/corrections",{
    sourceDocumentId,reason,
  },{headers:{cookie}}),db);
}

async function pay(db,cookie,bookingId,reference="STORNO-PAY") {
  return callWorker(jsonRequest("/api/staff/payments",{
    bookingId,method:"bank_transfer",providerReference:reference,
  },{headers:{cookie}}),db);
}

test("storno posts a separate correction and nets revenue, settlement, equipment and staff output",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw);
    const cookie=await seedStaffSession(db,{email:"storno@example.com",role:"registrar",organizationId:1});

    const response=await storno(db,cookie,seeded.sourceDocumentId);
    assert.equal(response.status,201);
    const body=await response.json();
    assert.equal(body.document.created,true);
    assert.match(body.document.number,/^СТ-\d{6}$/);
    assert.equal(body.document.sourceDocumentId,seeded.sourceDocumentId);

    const source=raw.prepare("SELECT state FROM business_documents WHERE id=?").get(seeded.sourceDocumentId);
    const correction=raw.prepare(
      "SELECT state,reversed_document_id AS sourceDocumentId FROM business_documents WHERE id=?"
    ).get(body.document.id);
    assert.equal(source.state,"reversed");
    assert.equal(correction.state,"posted");
    assert.equal(correction.sourceDocumentId,seeded.sourceDocumentId);

    const revenue=raw.prepare(
      "SELECT COUNT(*) AS n,SUM(amount_delta) AS total FROM revenue_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId);
    assert.equal(revenue.n,2);
    assert.equal(revenue.total,0);

    const settlement=raw.prepare(
      "SELECT COUNT(*) AS n,SUM(amount_delta) AS total FROM patient_settlement_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId);
    assert.equal(settlement.n,2);
    assert.equal(settlement.total,0);

    const load=raw.prepare(
      "SELECT COUNT(*) AS n,SUM(minutes_delta) AS total FROM equipment_load_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId);
    assert.equal(load.n,2);
    assert.equal(load.total,0);

    const output=raw.prepare(
      "SELECT COUNT(*) AS n,SUM(units_delta) AS total FROM staff_output_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId);
    assert.equal(output.n,4);
    assert.equal(output.total,0);

    const correctionMovement=raw.prepare(
      `SELECT quantity_delta AS quantityDelta,anatomical_regions_delta AS regionsDelta,reason
       FROM service_correction_movements WHERE organization_id=1 AND document_id=?`
    ).get(body.document.id);
    assert.equal(correctionMovement.quantityDelta,-1);
    assert.equal(correctionMovement.regionsDelta,-2);
    assert.match(correctionMovement.reason,/Помилково/);

    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM cash_movements WHERE organization_id=1 AND booking_id=?").get(seeded.bookingId).n,0);

    const again=await storno(db,cookie,seeded.sourceDocumentId,"Інша причина не повинна створити другий документ");
    assert.equal(again.status,200);
    const againBody=await again.json();
    assert.equal(againBody.document.created,false);
    assert.equal(againBody.document.id,body.document.id);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM service_correction_details WHERE organization_id=1 AND source_document_id=?").get(seeded.sourceDocumentId).n,1);
  });
});

test("storno after payment creates patient credit but does not return cash",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-STORNO-PAID",amount:3100});
    const cookie=await seedStaffSession(db,{email:"storno-paid@example.com",role:"registrar",organizationId:1});
    const paid=await pay(db,cookie,seeded.bookingId,"STORNO-PAID-REF");
    assert.equal(paid.status,200);

    assert.equal(raw.prepare(
      "SELECT SUM(amount_delta) AS total FROM patient_settlement_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId).total,0);
    assert.equal(raw.prepare(
      "SELECT SUM(amount_delta) AS total FROM cash_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId).total,3100);

    const reversed=await storno(db,cookie,seeded.sourceDocumentId,"Скасування оплаченої послуги");
    assert.equal(reversed.status,201);

    assert.equal(raw.prepare(
      "SELECT SUM(amount_delta) AS total FROM revenue_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId).total,0);
    assert.equal(raw.prepare(
      "SELECT SUM(amount_delta) AS total FROM patient_settlement_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId).total,-3100);
    assert.equal(raw.prepare(
      "SELECT SUM(amount_delta) AS total FROM cash_movements WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId).total,3100);
  });
});

test("military storno reverses operational output without inventing revenue or settlement",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-STORNO-MIL",category:"military",amount:2500});
    const cookie=await seedStaffSession(db,{email:"storno-mil@example.com",role:"registrar",organizationId:1});
    const response=await storno(db,cookie,seeded.sourceDocumentId,"Помилково зафіксоване виконання");
    assert.equal(response.status,201);

    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM revenue_movements WHERE booking_id=?").get(seeded.bookingId).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM patient_settlement_movements WHERE booking_id=?").get(seeded.bookingId).n,0);
    assert.equal(raw.prepare("SELECT SUM(minutes_delta) AS total FROM equipment_load_movements WHERE booking_id=?").get(seeded.bookingId).total,0);
    assert.equal(raw.prepare("SELECT SUM(units_delta) AS total FROM staff_output_movements WHERE booking_id=?").get(seeded.bookingId).total,0);
  });
});

test("reversed service facts stay immutable and cannot be auto-posted again",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-STORNO-FREEZE"});
    const cookie=await seedStaffSession(db,{email:"storno-freeze@example.com",role:"registrar",organizationId:1});
    const response=await storno(db,cookie,seeded.sourceDocumentId,"Помилкова послуга для перевірки блокування");
    assert.equal(response.status,201);

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET payment_amount=1 WHERE organization_id=1 AND id=?"
    ).run(seeded.bookingId),/service_delivery_booking_immutable/);
    assert.throws(()=>raw.prepare(
      `UPDATE bookings SET performed_at='2026-08-21T10:05:00',status='completed' WHERE organization_id=1 AND id=?`
    ).run(seeded.bookingId),/service_delivery_reversed/);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM service_delivery_details WHERE organization_id=1 AND booking_id=?"
    ).get(seeded.bookingId).n,1);
  });
});

test("tenant and role scope prevent foreign or clinical-only storno",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Storno Org 2','storno-org-2',1)");
    const foreign=await seedCompleted(db,raw,{organizationId:2,code:"RD-STORNO-ORG2"});
    const org1=await seedStaffSession(db,{email:"storno-org1@example.com",role:"registrar",organizationId:1});
    const doctor=await seedStaffSession(db,{email:"storno-doctor-role@example.com",role:"radiologist",organizationId:2});

    const wrongTenant=await storno(db,org1,foreign.sourceDocumentId,"Спроба чужого сторно");
    assert.equal(wrongTenant.status,404);
    const wrongRole=await storno(db,doctor,foreign.sourceDocumentId,"Спроба лікаря сторнувати");
    assert.equal(wrongRole.status,403);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM service_correction_details WHERE organization_id=2").get().n,0);
  });
});

test("D1 rejects forged negative register movement without a posted correction registrar",async()=>{
  await withD1(async(db,raw)=>{
    const seeded=await seedCompleted(db,raw,{code:"RD-STORNO-FORGE",amount:2700});
    assert.throws(()=>raw.prepare(
      `INSERT INTO revenue_movements
       (organization_id,document_id,booking_id,patient_id,service_code,movement_type,amount_delta,currency,actor_email)
       VALUES (1,?,?,?,'ct-chest','service_correction',-2700,'UAH','attacker@example.com')`
    ).run(seeded.sourceDocumentId,seeded.bookingId,""),/revenue_document_mismatch/);
  });
});
