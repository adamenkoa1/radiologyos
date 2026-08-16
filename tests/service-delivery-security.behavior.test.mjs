import assert from "node:assert/strict";
import test from "node:test";
import { seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-ACT-GUARD",time="17:00"}={}) {
  const rad="act-guard-rad@example.com";
  const tech="act-guard-tech@example.com";
  await seedStaffSession(db,{email:rad,role:"radiologist",organizationId:1});
  await seedStaffSession(db,{email:tech,role:"radiographer",organizationId:1});
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,duration_minutes,
      desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
      assigned_radiologist_email,assigned_radiographer_email,anatomical_regions_count,performed_at
    ) VALUES (1,?,'Guard Patient','+380501234567','380501234567','КТ ОГК','ct-chest','ct',30,
      '2026-08-27',?,'civilian','pending',2400,0,'completed',?,?,1,?)`
  ).bind(code,time,rad,tech,`2026-08-27T${time}:00`).run();
  return {bookingId:Number(result.meta.last_row_id),rad};
}

test("execution_recorded requires an active same-tenant staff actor",async()=>{
  await withD1(async(db,raw)=>{
    const {bookingId}=await seedBooking(db);
    await assert.rejects(
      db.prepare(
        `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
         VALUES (1,?,'execution_recorded','forged','attacker@example.com')`
      ).bind(bookingId).run(),
      /execution_recorded_actor_invalid/,
    );
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM service_delivery_details WHERE organization_id=1 AND booking_id=?"
    ).get(bookingId).n,0);
  });
});

test("posted service Act cannot be directly reversed before a correction flow exists",async()=>{
  await withD1(async(db,raw)=>{
    const {bookingId,rad}=await seedBooking(db,{code:"RD-ACT-REVERSAL",time:"18:00"});
    await db.prepare(
      `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
       VALUES (1,?,'execution_recorded','valid',?)`
    ).bind(bookingId,rad).run();
    const act=raw.prepare(
      "SELECT document_id AS documentId FROM service_delivery_details WHERE organization_id=1 AND booking_id=?"
    ).get(bookingId);
    assert.ok(act?.documentId);
    assert.throws(
      ()=>raw.prepare("UPDATE business_documents SET state='reversed' WHERE id=?").run(act.documentId),
      /service_delivery_requires_correction_document/,
    );
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(act.documentId).state,"posted");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM revenue_movements WHERE document_id=?").get(act.documentId).n,1);
  });
});
