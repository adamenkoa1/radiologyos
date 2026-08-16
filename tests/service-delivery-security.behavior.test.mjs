import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

test("draft service-delivery snapshot cannot be forged before posting",async()=>{
  await withD1(async(db,raw)=>{
    const booking=await db.prepare(
      `INSERT INTO bookings (
        organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
        duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
        status,performed_at,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
       ) VALUES (1,'RD-SVC-DRAFT-GUARD','Guard Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
         '2026-08-20','10:00','civilian','pending',2200,0,'completed','2026-08-20T10:05:00',2,
         'doctor@example.com','tech@example.com')`
    ).run();
    const bookingId=Number(booking.meta.last_row_id);
    const document=await db.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,occurred_at,state,comment,created_by)
       VALUES (1,'service_delivery','НП-DRAFT-GUARD','2026-08-20T10:05:00','draft','','guard@example.com')`
    ).run();
    const documentId=Number(document.meta.last_row_id);

    await db.prepare(
      `INSERT INTO service_delivery_details
       (organization_id,document_id,booking_id,patient_id,patient_category,service_code,service_title,
        equipment_id,duration_minutes,anatomical_regions_count,performed_at,radiologist_email,
        radiographer_email,price_amount,charge_amount,currency)
       VALUES (1,?,?,?,'civilian','ct-chest','КТ ОГК','ct',30,2,'2026-08-20T10:05:00',
         'doctor@example.com','tech@example.com',2200,2200,'UAH')`
    ).bind(documentId,bookingId,"").run();

    assert.throws(()=>raw.prepare(
      "UPDATE service_delivery_details SET charge_amount=1 WHERE organization_id=1 AND document_id=?"
    ).run(documentId),/service_delivery_charge_mismatch/);
    assert.throws(()=>raw.prepare(
      "UPDATE service_delivery_details SET service_code='forged' WHERE organization_id=1 AND document_id=?"
    ).run(documentId),/service_delivery_booking_snapshot_mismatch/);
    assert.throws(()=>raw.prepare(
      "UPDATE service_delivery_details SET organization_id=2 WHERE organization_id=1 AND document_id=?"
    ).run(documentId),/service_delivery_document_identity_immutable/);

    const unchanged=raw.prepare(
      "SELECT service_code,charge_amount FROM service_delivery_details WHERE organization_id=1 AND document_id=?"
    ).get(documentId);
    assert.equal(unchanged.service_code,"ct-chest");
    assert.equal(unchanged.charge_amount,2200);
  });
});
