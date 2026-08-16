import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function seedOrgBooking(db,{organizationId,code,time,rad,tech,name}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,duration_minutes,
      desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
      assigned_radiologist_email,assigned_radiographer_email,anatomical_regions_count,performed_at
    ) VALUES (?,?,?,'+380501234567','380501234567','КТ органів грудної клітки','ct-chest','ct',30,
      '2026-08-25',?,'civilian','pending',2100,0,'completed',?,?,2,?)`
  ).bind(organizationId,code,name,time,rad,tech,`2026-08-25T${time}:00`).run();
  const id=Number(result.meta.last_row_id);
  await db.prepare(
    `INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
     VALUES (?,?,'execution_recorded','api test',?)`
  ).bind(organizationId,id,rad).run();
  return id;
}

test("service-delivery journal is finance-role gated and tenant scoped",async()=>{
  await withD1(async(db)=>{
    await db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Other Clinic','other-clinic',1)").run();

    const org1Registrar=await seedStaffSession(db,{email:"act-reg-1@example.com",role:"registrar",organizationId:1});
    const org1RadCookie=await seedStaffSession(db,{email:"act-rad-1@example.com",role:"radiologist",organizationId:1});
    await seedStaffSession(db,{email:"act-tech-1@example.com",role:"radiographer",organizationId:1});

    const org2Registrar=await seedStaffSession(db,{email:"act-reg-2@example.com",role:"registrar",organizationId:2});
    await seedStaffSession(db,{email:"act-rad-2@example.com",role:"radiologist",organizationId:2});
    await seedStaffSession(db,{email:"act-tech-2@example.com",role:"radiographer",organizationId:2});

    await seedOrgBooking(db,{
      organizationId:1,code:"RD-ACT-ORG1",time:"09:00",name:"Org One Patient",
      rad:"act-rad-1@example.com",tech:"act-tech-1@example.com",
    });
    await seedOrgBooking(db,{
      organizationId:2,code:"RD-ACT-ORG2",time:"10:00",name:"Org Two Patient",
      rad:"act-rad-2@example.com",tech:"act-tech-2@example.com",
    });

    const denied=await callWorker(new Request("http://localhost/api/staff/service-delivery",{
      headers:{cookie:org1RadCookie},
    }),db);
    assert.equal(denied.status,403);

    const org1=await callWorker(new Request("http://localhost/api/staff/service-delivery",{
      headers:{cookie:org1Registrar},
    }),db);
    assert.equal(org1.status,200);
    const body1=await org1.json();
    assert.equal(body1.totals.acts,1);
    assert.equal(body1.documents.length,1);
    assert.equal(body1.documents[0].bookingCode,"RD-ACT-ORG1");
    assert.equal(JSON.stringify(body1).includes("Org Two Patient"),false);

    const org2=await callWorker(new Request("http://localhost/api/staff/service-delivery",{
      headers:{cookie:org2Registrar},
    }),db);
    assert.equal(org2.status,200);
    const body2=await org2.json();
    assert.equal(body2.totals.acts,1);
    assert.equal(body2.documents[0].bookingCode,"RD-ACT-ORG2");
    assert.equal(JSON.stringify(body2).includes("Org One Patient"),false);
  });
});
