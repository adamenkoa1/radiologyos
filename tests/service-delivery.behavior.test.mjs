import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedCompletedBooking(db,{
  code="RD-SVC-001",amount=2400,category="civilian",organizationId=1,
  radiologist="doctor@example.com",radiographer="tech@example.com",
}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,performed_at,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,'Service Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-20','10:00',?,'pending',?,0,'completed','2026-08-20T10:05:00',2,?,?)`
  ).bind(organizationId,code,category,amount,radiologist,radiographer).run();
  return Number(result.meta.last_row_id);
}

async function post(db,cookie,bookingId) {
  return callWorker(jsonRequest("/api/staff/service-deliveries",{bookingId},{headers:{cookie}}),db);
}

test("completed civilian service posts one BAS service document and all business registers",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedCompletedBooking(db);
    const cookie=await seedStaffSession(db,{email:"registrar-service@example.com",role:"registrar",organizationId:1});

    const first=await post(db,cookie,bookingId);
    assert.equal(first.status,200);
    const firstBody=await first.json();
    assert.equal(firstBody.created,true);
    assert.match(firstBody.document.number,/^НП-\d{6}$/);
    assert.equal(firstBody.document.chargeAmount,2400);

    const second=await post(db,cookie,bookingId);
    assert.equal(second.status,200);
    const secondBody=await second.json();
    assert.equal(secondBody.created,false);
    assert.equal(secondBody.document.id,firstBody.document.id);

    const doc=raw.prepare(
      "SELECT document_type,state FROM business_documents WHERE organization_id=1 AND id=?"
    ).get(firstBody.document.id);
    assert.equal(doc.document_type,"service_delivery");
    assert.equal(doc.state,"posted");

    const detail=raw.prepare(
      `SELECT booking_id,service_code,equipment_id,duration_minutes,anatomical_regions_count,
              price_amount,charge_amount,performed_at
       FROM service_delivery_details WHERE organization_id=1 AND document_id=?`
    ).get(firstBody.document.id);
    assert.equal(detail.booking_id,bookingId);
    assert.equal(detail.service_code,"ct-chest");
    assert.equal(detail.equipment_id,"ct");
    assert.equal(detail.duration_minutes,30);
    assert.equal(detail.anatomical_regions_count,2);
    assert.equal(detail.price_amount,2400);
    assert.equal(detail.charge_amount,2400);
    assert.equal(detail.performed_at,"2026-08-20T10:05:00");

    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM services_delivered_movements WHERE organization_id=1 AND document_id=?"
    ).get(firstBody.document.id).n,1);
    assert.equal(raw.prepare(
      "SELECT minutes_delta FROM equipment_load_movements WHERE organization_id=1 AND document_id=?"
    ).get(firstBody.document.id).minutes_delta,30);
    assert.equal(raw.prepare(
      "SELECT amount_delta FROM revenue_movements WHERE organization_id=1 AND document_id=?"
    ).get(firstBody.document.id).amount_delta,2400);
    assert.equal(raw.prepare(
      "SELECT amount_delta FROM patient_settlement_movements WHERE organization_id=1 AND document_id=?"
    ).get(firstBody.document.id).amount_delta,2400);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM staff_output_movements WHERE organization_id=1 AND document_id=?"
    ).get(firstBody.document.id).n,2);

    assert.throws(()=>raw.prepare(
      "UPDATE revenue_movements SET amount_delta=1 WHERE document_id=?"
    ).run(firstBody.document.id),/revenue_movement_immutable/);
    assert.throws(()=>raw.prepare(
      "DELETE FROM equipment_load_movements WHERE document_id=?"
    ).run(firstBody.document.id),/equipment_load_movement_immutable/);
    assert.throws(()=>raw.prepare(
      "UPDATE service_delivery_details SET charge_amount=1 WHERE document_id=?"
    ).run(firstBody.document.id),/service_delivery_not_draft/);
  });
});

test("free military service records operational output without inventing revenue or patient debt",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedCompletedBooking(db,{code:"RD-SVC-MIL",amount:2400,category:"military"});
    const cookie=await seedStaffSession(db,{email:"registrar-military@example.com",role:"registrar",organizationId:1});
    const response=await post(db,cookie,bookingId);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.document.chargeAmount,0);

    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM services_delivered_movements WHERE document_id=?"
    ).get(body.document.id).n,1);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM equipment_load_movements WHERE document_id=?"
    ).get(body.document.id).n,1);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM staff_output_movements WHERE document_id=?"
    ).get(body.document.id).n,2);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM revenue_movements WHERE document_id=?"
    ).get(body.document.id).n,0);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM patient_settlement_movements WHERE document_id=?"
    ).get(body.document.id).n,0);
  });
});

test("service delivery fails closed before the study is actually performed",async()=>{
  await withD1(async(db,raw)=>{
    const result=await db.prepare(
      `INSERT INTO bookings (
        organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
        duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status
       ) VALUES (1,'RD-SVC-NOT-DONE','Pending Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
         '2026-08-20','11:00','civilian','pending',1800,0,'confirmed')`
    ).run();
    const bookingId=Number(result.meta.last_row_id);
    const cookie=await seedStaffSession(db,{email:"registrar-pending@example.com",role:"registrar",organizationId:1});

    const response=await post(db,cookie,bookingId);
    assert.equal(response.status,409);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM business_documents WHERE organization_id=1 AND document_type='service_delivery'"
    ).get().n,0);
  });
});

test("service delivery journal is tenant scoped",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Service Org 2','service-org-2',1)");
    const booking1=await seedCompletedBooking(db,{code:"RD-SVC-T1",organizationId:1});
    const booking2=await seedCompletedBooking(db,{code:"RD-SVC-T2",organizationId:2});
    const staff1=await seedStaffSession(db,{email:"service-org1@example.com",role:"registrar",organizationId:1});
    const staff2=await seedStaffSession(db,{email:"service-org2@example.com",role:"registrar",organizationId:2});
    assert.equal((await post(db,staff1,booking1)).status,200);
    assert.equal((await post(db,staff2,booking2)).status,200);

    const list=await callWorker(new Request("http://localhost/api/staff/service-deliveries",{headers:{cookie:staff1}}),db);
    assert.equal(list.status,200);
    const body=await list.json();
    assert.equal(body.documents.length,1);
    assert.equal(body.documents[0].bookingCode,"RD-SVC-T1");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM service_delivery_details").get().n,2);
  });
});

test("D1 rejects forged service register movements that do not match the posted registrar",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedCompletedBooking(db,{code:"RD-SVC-FORGE",amount:2100});
    const cookie=await seedStaffSession(db,{email:"service-forge@example.com",role:"registrar",organizationId:1});
    const response=await post(db,cookie,bookingId);
    const body=await response.json();
    assert.equal(response.status,200);

    assert.throws(()=>raw.prepare(
      `INSERT INTO revenue_movements
       (organization_id,document_id,booking_id,patient_id,service_code,movement_type,amount_delta,currency,actor_email,occurred_at)
       VALUES (1,?,?,?,'ct-chest','service_delivery',1,'UAH','attacker@example.com','2026-08-20T10:05:00')`
    ).run(body.document.id,bookingId,""),/revenue_document_mismatch/);

    assert.throws(()=>raw.prepare(
      `INSERT INTO equipment_load_movements
       (organization_id,document_id,booking_id,equipment_id,minutes_delta,performed_at,actor_email,occurred_at)
       VALUES (1,?,?,'ct',1,'2026-08-20T10:05:00','attacker@example.com','2026-08-20T10:05:00')`
    ).run(body.document.id,bookingId),/equipment_load_document_mismatch/);
  });
});
