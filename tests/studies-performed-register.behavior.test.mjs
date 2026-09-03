import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

// Dates anchored to "now" so the report window always contains the storno document
// that the correction API creates with CURRENT_TIMESTAMP; a hardcoded calendar
// window drifts out of range once the wall clock moves past it.
const ISO = (ms) => new Date(ms).toISOString().slice(0, 10);
const NOW = Date.now();
const REPORT_FROM = ISO(NOW - 20 * 86400000);
const REPORT_TO = ISO(NOW + 86400000);
const IN_PERIOD = ISO(NOW - 5 * 86400000);

async function seedCompleted(db,{
  organizationId=1,
  code,
  amount=0,
  category="civilian",
  performedAt,
  duration=30,
  regions=1,
  serviceCode="ct-chest",
  service="КТ ОГК",
}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,?,'+380501112233','380501112233',?,?,'ct',?,
       ?,?,?,'pending',?,0,'confirmed',?,'studies-doctor@example.com','studies-tech@example.com')`
  ).bind(
    organizationId,code,`Patient ${code}`,service,serviceCode,duration,
    performedAt.slice(0,10),performedAt.slice(11,16),category,amount,regions,
  ).run();
  const bookingId=Number(result.meta.last_row_id);
  await db.prepare(
    "UPDATE bookings SET performed_at=?,status='completed' WHERE organization_id=? AND id=?"
  ).bind(performedAt,organizationId,bookingId).run();
  return bookingId;
}

async function serviceDocumentId(db,organizationId,bookingId) {
  const row=await db.prepare(
    `SELECT d.id FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=? AND s.booking_id=? AND d.document_type='service_delivery' LIMIT 1`
  ).bind(organizationId,bookingId).first();
  return Number(row?.id||0);
}

async function storno(db,cookie,sourceDocumentId) {
  return callWorker(jsonRequest("/api/staff/service-deliveries/corrections",{
    sourceDocumentId,
    reason:"Сторно для регістру виконаних досліджень",
  },{headers:{cookie}}),db);
}

async function report(db,cookie) {
  return callWorker(new Request(
    `http://localhost/api/staff/reports/registers?from=${REPORT_FROM}&to=${REPORT_TO}`,
    {headers:{cookie}},
  ),db);
}

test("studies_performed projection includes civilian, military and explicit storno facts",async()=>{
  await withD1(async(db)=>{
    const admin=await seedStaffSession(db,{email:"studies-admin@example.com",role:"admin",organizationId:1});

    const civilian=await seedCompleted(db,{
      code:"RD-STUDIES-CIV",amount:3000,category:"civilian",performedAt:`${IN_PERIOD}T10:00:00`,regions:2,
    });
    const military=await seedCompleted(db,{
      code:"RD-STUDIES-MIL",amount:5000,category:"military",performedAt:`${IN_PERIOD}T11:00:00`,regions:1,
    });
    assert.ok(civilian>0);
    assert.ok(military>0);

    const sourceId=await serviceDocumentId(db,1,civilian);
    assert.ok(sourceId>0);
    const reversed=await storno(db,admin,sourceId);
    assert.equal(reversed.status,201);

    const response=await report(db,admin);
    assert.equal(response.status,200);
    const body=await response.json();

    assert.deepEqual(body.registers.studies,{increase:2,decrease:1,net:1,regionsNet:1});
    assert.deepEqual(body.registers.services,body.registers.studies,"legacy services projection must remain compatible");

    const chest=body.breakdowns.studiesByService.find(row=>row.serviceCode==="ct-chest");
    assert.deepEqual(chest,{serviceCode:"ct-chest",performed:2,reversed:1,net:1,regionsNet:1});

    assert.equal(body.registers.revenue.net,0,"storned civilian + military-free completion must not leave revenue");
  });
});

test("studies_performed projection is tenant scoped",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Studies Org 2','studies-org-2',1)");
    const org1=await seedStaffSession(db,{email:"studies-org1@example.com",role:"admin",organizationId:1});
    const org2=await seedStaffSession(db,{email:"studies-org2@example.com",role:"admin",organizationId:2});

    await seedCompleted(db,{
      organizationId:1,code:"RD-STUDIES-ORG1",amount:0,category:"military",performedAt:`${IN_PERIOD}T09:00:00`,regions:1,
    });
    await seedCompleted(db,{
      organizationId:2,code:"RD-STUDIES-ORG2",amount:0,category:"military",performedAt:`${IN_PERIOD}T09:30:00`,regions:4,
      serviceCode:"ct-abdomen",service:"КТ ОЧП",
    });

    const one=await report(db,org1);const oneBody=await one.json();
    const two=await report(db,org2);const twoBody=await two.json();
    assert.deepEqual(oneBody.registers.studies,{increase:1,decrease:0,net:1,regionsNet:1});
    assert.deepEqual(twoBody.registers.studies,{increase:1,decrease:0,net:1,regionsNet:4});
    assert.equal(oneBody.breakdowns.studiesByService.some(row=>row.serviceCode==="ct-abdomen"),false);
    assert.equal(twoBody.breakdowns.studiesByService.some(row=>row.serviceCode==="ct-abdomen"),true);
  });
});
