import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

function daysBefore(dateText,days){
  const date=new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()-days);
  return date.toISOString().slice(0,10);
}

async function seedBooking(db,{organizationId=1,code,patientId,phone,amount,scheduledDate,performedAt=""}){
  await db.prepare(`INSERT OR IGNORE INTO patient_profiles
    (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES (?,?,?,?,'receivables-test')`)
    .bind(patientId,organizationId,phone,`Patient ${code}`).run();
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (?,?,?, ?,?,?, '1980-01-02','КТ ОГК','ct-chest','ct',30,?,'10:00','civilian','pending',?,0,'confirmed',1,
      'receivable-doctor@example.com','receivable-tech@example.com')`)
    .bind(organizationId,code,`Patient ${code}`,`+${phone}`,phone,patientId,scheduledDate,amount).run();
  const bookingId=Number(result.meta.last_row_id);
  if(performedAt){
    await db.prepare("UPDATE bookings SET performed_at=?,status='completed' WHERE organization_id=? AND id=?")
      .bind(performedAt,organizationId,bookingId).run();
  }
  return bookingId;
}

async function pay(db,cookie,bookingId,reference){
  return callWorker(jsonRequest("/api/staff/payments",{bookingId,method:"bank_transfer",providerReference:reference},{headers:{cookie}}),db);
}

async function refund(db,cookie,bookingId){
  return callWorker(new Request("http://localhost/api/staff/payments",{
    method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId}),
  }),db);
}

async function report(db,cookie,asOf){
  return callWorker(new Request(`http://localhost/api/staff/reports/receivables?asOf=${asOf}`,{headers:{cookie}}),db);
}

test("receivables report derives debt, credits and aging from immutable patient settlements",async()=>{
  await withD1(async(db,raw)=>{
    const today=String((await db.prepare("SELECT date('now') AS today").first()).today);
    const oldDate=daysBefore(today,75);
    const paidDate=daysBefore(today,50);
    const refundServiceDate=daysBefore(today,120);
    const admin=await seedStaffSession(db,{email:"receivables-admin@example.com",role:"admin",organizationId:1});

    const oldDebt=await seedBooking(db,{organizationId:1,code:"RD-REC-OLD",patientId:"PAT-REC-OLD",phone:"380501236001",amount:1000,scheduledDate:oldDate,performedAt:`${oldDate}T10:05:00`});
    const paidBooking=await seedBooking(db,{organizationId:1,code:"RD-REC-PAID",patientId:"PAT-REC-PAID",phone:"380501236002",amount:2000,scheduledDate:paidDate,performedAt:`${paidDate}T10:05:00`});
    assert.equal((await pay(db,admin,paidBooking,"REC-PAID")).status,200);

    const reopened=await seedBooking(db,{organizationId:1,code:"RD-REC-REFUND",patientId:"PAT-REC-REFUND",phone:"380501236003",amount:3000,scheduledDate:refundServiceDate,performedAt:`${refundServiceDate}T10:05:00`});
    assert.equal((await pay(db,admin,reopened,"REC-REFUND")).status,200);
    assert.equal((await refund(db,admin,reopened)).status,200);

    const credit=await seedBooking(db,{organizationId:1,code:"RD-REC-CREDIT",patientId:"PAT-REC-CREDIT",phone:"380501236004",amount:1500,scheduledDate:today});
    assert.equal((await pay(db,admin,credit,"REC-CREDIT")).status,200);

    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Receivables Org 2','receivables-org-2',1)");
    const otherDate=daysBefore(today,100);
    await seedBooking(db,{organizationId:2,code:"RD-REC-ORG2",patientId:"PAT-REC-ORG2",phone:"380501236005",amount:9000,scheduledDate:otherDate,performedAt:`${otherDate}T10:05:00`});

    const response=await report(db,admin,today);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.asOf,today);
    assert.equal(body.truncated,false);
    assert.equal(body.summary.receivables,4000);
    assert.equal(body.summary.patientCredits,1500);
    assert.equal(body.summary.debtorBookings,2);
    assert.equal(body.summary.creditBookings,1);
    assert.equal(body.summary.buckets["61_90"],1000);
    assert.equal(body.summary.buckets["0_30"],3000);
    assert.equal(body.summary.buckets["31_60"],0);
    assert.equal(body.summary.buckets["90_plus"],0);

    const old=body.debtors.find(row=>row.bookingId===oldDebt);
    assert.ok(old);assert.equal(old.balance,1000);assert.equal(old.outstandingSince,oldDate);assert.equal(old.ageDays,75);assert.equal(old.bucket,"61_90");
    const reopenedRow=body.debtors.find(row=>row.bookingId===reopened);
    assert.ok(reopenedRow);assert.equal(reopenedRow.balance,3000);assert.equal(reopenedRow.outstandingSince,today);assert.equal(reopenedRow.ageDays,0);assert.equal(reopenedRow.bucket,"0_30");
    assert.ok(!body.debtors.some(row=>row.bookingId===paidBooking));
    assert.ok(!body.debtors.some(row=>row.bookingCode==="RD-REC-ORG2"));
    const creditRow=body.credits.find(row=>row.bookingId===credit);
    assert.ok(creditRow);assert.equal(creditRow.balance,-1500);

    const auditRow=raw.prepare(`SELECT details_json AS details FROM security_audit_log
      WHERE organization_id=1 AND actor_email='receivables-admin@example.com'
        AND action='report_viewed' AND target_id='receivables'
      ORDER BY id DESC LIMIT 1`).get();
    assert.ok(auditRow);
    assert.deepEqual(JSON.parse(auditRow.details),{asOf:today,rows:3,truncated:false});
    assert.ok(!auditRow.details.includes("RD-REC"));
    assert.ok(!auditRow.details.includes("Patient"));
  });
});

test("receivables report validates date and stays admin-only",async()=>{
  await withD1(async(db)=>{
    const today=String((await db.prepare("SELECT date('now') AS today").first()).today);
    const admin=await seedStaffSession(db,{email:"receivables-date-admin@example.com",role:"admin",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"receivables-registrar@example.com",role:"registrar",organizationId:1});
    const doctor=await seedStaffSession(db,{email:"receivables-doctor@example.com",role:"radiologist",organizationId:1});
    assert.equal((await report(db,registrar,today)).status,403);
    assert.equal((await report(db,doctor,today)).status,403);
    assert.equal((await report(db,admin,"not-a-date")).status,400);
  });
});
