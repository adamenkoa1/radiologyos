import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-CANCEL-TERM-1",patientId="PAT-CANCEL-TERM"}={}){
  await db.prepare(`INSERT OR IGNORE INTO patient_profiles
    (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES (?,1,'380501234511','Cancellation Patient','cancel-terminal-test')`).bind(patientId).run();
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (1,?,'Cancellation Patient','+380501234511','380501234511',?,'1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-10-02','10:00','civilian','pending',2500,0,'confirmed',1,'cancel-doctor@example.com','cancel-tech@example.com')`)
    .bind(code,patientId).run();
  return Number(result.meta.last_row_id);
}

function orderState(raw,bookingId){
  return raw.prepare(`SELECT d.state FROM patient_order_details o
    JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
    WHERE o.organization_id=1 AND o.booking_id=? LIMIT 1`).get(bookingId)?.state;
}

function appointmentStates(raw,bookingId){
  return raw.prepare(`SELECT d.state FROM appointment_details a
    JOIN business_documents d ON d.id=a.document_id AND d.organization_id=a.organization_id
    WHERE a.organization_id=1 AND a.booking_id=? ORDER BY a.appointment_version`).all(bookingId).map(row=>row.state);
}

function serviceCount(raw,bookingId){
  return Number(raw.prepare(`SELECT COUNT(*) AS n FROM service_delivery_details
    WHERE organization_id=1 AND booking_id=?`).get(bookingId).n);
}

test("cancelled booking is terminal and cannot be resurrected to an active state",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?").bind(bookingId).run();

    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"cancelled");
    assert.equal(orderState(raw,bookingId),"cancelled");
    assert.deepEqual(appointmentStates(raw,bookingId),["reversed"]);

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET status='confirmed' WHERE organization_id=1 AND id=?"
    ).run(bookingId),/booking_cancelled_terminal/);
    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"cancelled");
    assert.equal(serviceCount(raw,bookingId),0);
  });
});

test("cancelled booking cannot be resurrected directly into completed execution",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-CANCEL-TERM-2",patientId:"PAT-CANCEL-TERM-2"});
    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?").bind(bookingId).run();

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET status='completed',performed_at='2026-10-02T10:05:00' WHERE organization_id=1 AND id=?"
    ).run(bookingId),/booking_cancelled_terminal/);

    const booking=raw.prepare("SELECT status,performed_at AS performedAt FROM bookings WHERE id=?").get(bookingId);
    assert.equal(booking.status,"cancelled");
    assert.equal(booking.performedAt,"");
    assert.equal(orderState(raw,bookingId),"cancelled");
    assert.deepEqual(appointmentStates(raw,bookingId),["reversed"]);
    assert.equal(serviceCount(raw,bookingId),0);
  });
});

test("ordinary cancellation still succeeds and repeated cancelled status is an idempotent no-op",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-CANCEL-TERM-3",patientId:"PAT-CANCEL-TERM-3"});
    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?").bind(bookingId).run();
    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?").bind(bookingId).run();

    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"cancelled");
    assert.equal(orderState(raw,bookingId),"cancelled");
    assert.deepEqual(appointmentStates(raw,bookingId),["reversed"]);
    assert.equal(serviceCount(raw,bookingId),0);
  });
});
