import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedCompleted(db,raw,{organizationId=1,code="RD-SVC-JOURNAL",amount=2200}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count
     ) VALUES (?,?,'Journal Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-20','15:00','civilian','pending',?,0,'confirmed',1)`
  ).bind(organizationId,code,amount).run();
  const bookingId=Number(result.meta.last_row_id);
  await db.prepare(
    "UPDATE bookings SET performed_at='2026-08-20T15:05:00',status='completed' WHERE organization_id=? AND id=?"
  ).bind(organizationId,bookingId).run();
  const document=raw.prepare(
    `SELECT d.id FROM business_documents d JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=? AND s.booking_id=? AND d.document_type='service_delivery'`
  ).get(organizationId,bookingId);
  return {bookingId,documentId:document.id};
}

test("service delivery journal returns posted business documents for the active tenant",async()=>{
  await withD1(async(db,raw)=>{
    const own=await seedCompleted(db,raw,{code:"RD-SVC-JOURNAL-OWN"});
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Journal Org 2','journal-org-2',1)");
    await seedCompleted(db,raw,{organizationId:2,code:"RD-SVC-JOURNAL-FOREIGN",amount:3300});
    const cookie=await seedStaffSession(db,{email:"journal@example.com",role:"registrar",organizationId:1});

    const response=await callWorker(new Request("http://localhost/api/staff/service-deliveries",{headers:{cookie}}),db);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.ok(body.documents.some((row)=>row.id===own.documentId && row.bookingCode==="RD-SVC-JOURNAL-OWN"));
    assert.equal(body.documents.some((row)=>row.bookingCode==="RD-SVC-JOURNAL-FOREIGN"),false);
  });
});

test("service delivery journal remains finance-role scoped",async()=>{
  await withD1(async(db,raw)=>{
    await seedCompleted(db,raw,{code:"RD-SVC-JOURNAL-ROLE"});
    const doctor=await seedStaffSession(db,{email:"journal-doctor@example.com",role:"radiologist",organizationId:1});
    const response=await callWorker(new Request("http://localhost/api/staff/service-deliveries",{headers:{cookie:doctor}}),db);
    assert.equal(response.status,403);
  });
});
