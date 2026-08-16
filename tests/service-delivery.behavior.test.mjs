import assert from "node:assert/strict";
import test from "node:test";
import { seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function seedExecutionStaff(db) {
  await seedStaffSession(db,{email:"rad-act@example.com",role:"radiologist",organizationId:1});
  await seedStaffSession(db,{email:"tech-act@example.com",role:"radiographer",organizationId:1});
  await seedStaffSession(db,{email:"registrar-act@example.com",role:"registrar",organizationId:1});
}

async function seedBooking(db,{
  code="RD-ACT-1",
  category="civilian",
  amount=2500,
  time="09:00",
}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,duration_minutes,
      desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
      assigned_radiologist_email,assigned_radiographer_email,anatomical_regions_count
    ) VALUES (
      1,?,'Act Patient','+380501234567','380501234567','КТ органів грудної клітки','ct-chest','ct',30,
      '2026-08-24',?,?, 'pending',?,0,'confirmed','rad-act@example.com','tech-act@example.com',1
    )`
  ).bind(code,time,category,amount).run();
  return Number(result.meta.last_row_id);
}

async function recordExecution(db,bookingId,performedAt="2026-08-24T09:05:00",regions=2) {
  await db.prepare(
    `UPDATE bookings SET performed_at=?,anatomical_regions_count=?,status='completed'
     WHERE organization_id=1 AND id=?`
  ).bind(performedAt,regions,bookingId).run();
  await db.prepare(
    `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
     VALUES (1,?,'execution_recorded','test execution','registrar-act@example.com')`
  ).bind(bookingId).run();
}

test("execution_recorded posts exactly one service act and business registers",async()=>{
  await withD1(async(db,raw)=>{
    await seedExecutionStaff(db);
    const bookingId=await seedBooking(db);
    await recordExecution(db,bookingId);

    const act=raw.prepare(
      `SELECT d.id,d.document_type AS type,d.number,d.state,d.created_by AS createdBy,d.posted_by AS postedBy,
              s.charge_amount AS chargeAmount,s.service_code AS serviceCode,s.equipment_id AS equipmentId,
              s.anatomical_regions_count AS regions,s.performed_at AS performedAt
       FROM business_documents d
       JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
       WHERE d.organization_id=1 AND s.booking_id=?`
    ).get(bookingId);
    assert.ok(act);
    assert.equal(act.type,"service_delivery");
    assert.equal(act.state,"posted");
    assert.equal(act.number,`АКТ-${String(bookingId).padStart(6,"0")}`);
    assert.equal(act.createdBy,"registrar-act@example.com");
    assert.equal(act.postedBy,"registrar-act@example.com");
    assert.equal(act.chargeAmount,2500);
    assert.equal(act.serviceCode,"ct-chest");
    assert.equal(act.equipmentId,"ct");
    assert.equal(act.regions,2);

    const revenue=raw.prepare(
      `SELECT amount_delta AS amountDelta,movement_type AS movementType FROM revenue_movements
       WHERE organization_id=1 AND document_id=?`
    ).get(act.id);
    assert.ok(revenue);
    assert.equal(revenue.amountDelta,2500);
    assert.equal(revenue.movementType,"service_charge");

    const settlement=raw.prepare(
      `SELECT amount_delta AS amountDelta,movement_type AS movementType FROM patient_settlement_movements
       WHERE organization_id=1 AND document_id=?`
    ).get(act.id);
    assert.ok(settlement);
    assert.equal(settlement.amountDelta,2500);
    assert.equal(settlement.movementType,"charge");

    const workload=raw.prepare(
      `SELECT study_count AS studyCount,duration_minutes AS durationMinutes,anatomical_regions_count AS regions
       FROM equipment_workload_movements WHERE organization_id=1 AND document_id=?`
    ).get(act.id);
    assert.ok(workload);
    assert.equal(workload.studyCount,1);
    assert.equal(workload.durationMinutes,30);
    assert.equal(workload.regions,2);

    const staff=raw.prepare(
      `SELECT staff_email AS email,staff_role AS role,study_count AS studyCount,anatomical_regions_count AS regions
       FROM staff_output_movements WHERE organization_id=1 AND document_id=? ORDER BY staff_role`
    ).all(act.id);
    assert.equal(staff.length,2);
    assert.equal(staff[0].email,"rad-act@example.com");
    assert.equal(staff[0].role,"radiologist");
    assert.equal(staff[0].studyCount,1);
    assert.equal(staff[0].regions,2);
    assert.equal(staff[1].email,"tech-act@example.com");
    assert.equal(staff[1].role,"radiographer");
    assert.equal(staff[1].studyCount,1);
    assert.equal(staff[1].regions,2);

    await db.prepare(
      `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
       VALUES (1,?,'execution_recorded','duplicate retry','registrar-act@example.com')`
    ).bind(bookingId).run();
    assert.equal(raw.prepare(
      `SELECT COUNT(*) AS n FROM service_delivery_details WHERE organization_id=1 AND booking_id=?`
    ).get(bookingId).n,1);
    assert.equal(raw.prepare(
      `SELECT COUNT(*) AS n FROM revenue_movements WHERE organization_id=1 AND booking_id=?`
    ).get(bookingId).n,1);
  });
});

test("military execution posts workload and staff output without commercial revenue or patient charge",async()=>{
  await withD1(async(db,raw)=>{
    await seedExecutionStaff(db);
    const bookingId=await seedBooking(db,{code:"RD-ACT-MIL",category:"military",amount:3200,time:"10:00"});
    await recordExecution(db,bookingId,"2026-08-24T10:03:00",1);

    const act=raw.prepare(
      `SELECT d.id,s.charge_amount AS chargeAmount FROM business_documents d
       JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
       WHERE d.organization_id=1 AND s.booking_id=?`
    ).get(bookingId);
    assert.ok(act);
    assert.equal(act.chargeAmount,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM revenue_movements WHERE document_id=?").get(act.id).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM patient_settlement_movements WHERE document_id=?").get(act.id).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM equipment_workload_movements WHERE document_id=?").get(act.id).n,1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_output_movements WHERE document_id=?").get(act.id).n,2);
  });
});

test("manual completed status without performed_at is not an economic service fact",async()=>{
  await withD1(async(db,raw)=>{
    await seedExecutionStaff(db);
    const bookingId=await seedBooking(db,{code:"RD-NO-ACT",time:"11:00"});
    await db.prepare("UPDATE bookings SET status='completed' WHERE organization_id=1 AND id=?").bind(bookingId).run();
    await db.prepare(
      `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
       VALUES (1,?,'status_changed','completed','registrar-act@example.com')`
    ).bind(bookingId).run();
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM service_delivery_details WHERE organization_id=1 AND booking_id=?"
    ).get(bookingId).n,0);
  });
});

test("posted service act freezes the economic execution snapshot but not unrelated medical reference metadata",async()=>{
  await withD1(async(db,raw)=>{
    await seedExecutionStaff(db);
    const bookingId=await seedBooking(db,{code:"RD-ACT-LOCK",time:"12:00"});
    await recordExecution(db,bookingId,"2026-08-24T12:01:00",3);

    assert.throws(()=>raw.prepare("UPDATE bookings SET performed_at='2026-08-24T12:09:00' WHERE id=?").run(bookingId),/service_delivery_booking_fact_immutable/);
    assert.throws(()=>raw.prepare("UPDATE bookings SET payment_amount=9999 WHERE id=?").run(bookingId),/service_delivery_booking_fact_immutable/);
    assert.throws(()=>raw.prepare("UPDATE bookings SET anatomical_regions_count=4 WHERE id=?").run(bookingId),/service_delivery_booking_fact_immutable/);
    assert.throws(()=>raw.prepare("UPDATE bookings SET service_code='ct-head' WHERE id=?").run(bookingId),/service_delivery_booking_fact_immutable/);

    raw.prepare("UPDATE bookings SET external_reference='PACS-UPDATED' WHERE id=?").run(bookingId);
    assert.equal(raw.prepare("SELECT external_reference AS ref FROM bookings WHERE id=?").get(bookingId).ref,"PACS-UPDATED");
  });
});

test("service delivery registers reject forged movements and remain append-only",async()=>{
  await withD1(async(db,raw)=>{
    await seedExecutionStaff(db);
    const bookingId=await seedBooking(db,{code:"RD-ACT-SEC",time:"13:00"});
    await recordExecution(db,bookingId,"2026-08-24T13:02:00",2);
    const act=raw.prepare(
      "SELECT document_id AS documentId FROM service_delivery_details WHERE organization_id=1 AND booking_id=?"
    ).get(bookingId);

    assert.throws(()=>raw.prepare(
      `INSERT INTO revenue_movements
       (organization_id,document_id,booking_id,movement_type,amount_delta,currency,service_code,actor_email,occurred_at)
       VALUES (1,?,?,'service_charge',1,'UAH','ct-chest','attacker@example.com','2026-08-24T13:02:00')`
    ).run(act.documentId,bookingId),/revenue_service_delivery_mismatch/);

    assert.throws(()=>raw.prepare("UPDATE revenue_movements SET amount_delta=1 WHERE document_id=?").run(act.documentId),/revenue_movement_immutable/);
    assert.throws(()=>raw.prepare("DELETE FROM equipment_workload_movements WHERE document_id=?").run(act.documentId),/equipment_workload_movement_immutable/);
    assert.throws(()=>raw.prepare("UPDATE staff_output_movements SET anatomical_regions_count=1 WHERE document_id=?").run(act.documentId),/staff_output_movement_immutable/);
  });
});
