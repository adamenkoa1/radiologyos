import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{organizationId=1,code,serviceCode,serviceTitle}){
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,status,payment_amount)
    VALUES (?,?,?,? ,?,'1980-01-02',?,?,'ct',30,'2026-08-19','10:00','civilian','completed',0)`)
    .bind(organizationId,code,`Patient ${code}`,`+38050${code.slice(-6)}`,`38050${code.slice(-6)}`,serviceTitle,serviceCode).run();
  return Number(result.meta.last_row_id);
}

async function seedDocument(db,{organizationId=1,type="service_delivery",number,occurredAt}){
  const result=await db.prepare(`INSERT INTO business_documents
    (organization_id,document_type,number,occurred_at,state,created_by,posted_by,posted_at)
    VALUES (?,?,?,?, 'posted','margin-test','margin-test',?)`)
    .bind(organizationId,type,number,occurredAt,occurredAt).run();
  return Number(result.meta.last_row_id);
}

function dropInsertGuards(raw,table){
  const rows=raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND upper(sql) LIKE '%BEFORE INSERT%'").all(table);
  for(const row of rows){
    const name=String(row.name).replaceAll('"','""');
    raw.exec(`DROP TRIGGER "${name}"`);
  }
}

async function addRevenue(db,{organizationId=1,documentId,bookingId,serviceCode,amount,occurredAt,type="service_delivery"}){
  await db.prepare(`INSERT INTO revenue_movements
    (organization_id,document_id,booking_id,patient_id,service_code,movement_type,amount_delta,currency,actor_email,occurred_at)
    VALUES (?,?,?,'',?,?,?,'UAH','margin-test',?)`)
    .bind(organizationId,documentId,bookingId,serviceCode,type,amount,occurredAt).run();
}

async function addExpense(db,{organizationId=1,id,bookingId,amount,occurredAt}){
  await db.prepare(`INSERT INTO expense_movements
    (organization_id,inventory_movement_id,document_id,document_line_id,source_receipt_document_id,source_receipt_line_id,
     booking_id,item_id,lot_id,warehouse_id,unit_cost,amount_delta,currency,reason,actor_email,occurred_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,'UAH','margin-test','margin-test',?)`)
    .bind(organizationId,id,id,id,id,id,bookingId,1,1,1,amount,occurredAt).run();
}

async function report(db,cookie,from="2026-08-01",to="2026-08-31"){
  return callWorker(new Request(`http://localhost/api/staff/reports/material-margin?from=${from}&to=${to}`,{headers:{cookie}}),db);
}

test("service material margin uses posted revenue and booking-linked acquisition cost without cross-tenant allocation",async()=>{
  await withD1(async(db,raw)=>{
    dropInsertGuards(raw,"revenue_movements");
    dropInsertGuards(raw,"expense_movements");

    const admin=await seedStaffSession(db,{email:"margin-admin@example.com",role:"admin",organizationId:1});
    const ct=await seedBooking(db,{code:"MARG01",serviceCode:"ct-chest",serviceTitle:"КТ ОГК"});
    const xray=await seedBooking(db,{code:"MARG02",serviceCode:"xray-chest",serviceTitle:"Рентген ОГК"});
    const military=await seedBooking(db,{code:"MARG03",serviceCode:"ct-head",serviceTitle:"КТ голови"});

    const ctDelivery=await seedDocument(db,{number:"M-D-1",occurredAt:"2026-08-10T10:00:00"});
    const ctCorrection=await seedDocument(db,{type:"service_correction",number:"M-C-1",occurredAt:"2026-08-11T10:00:00"});
    const xrayDelivery=await seedDocument(db,{number:"M-D-2",occurredAt:"2026-08-12T10:00:00"});
    await addRevenue(db,{documentId:ctDelivery,bookingId:ct,serviceCode:"ct-chest",amount:1000,occurredAt:"2026-08-10T10:00:00"});
    await addRevenue(db,{documentId:ctCorrection,bookingId:ct,serviceCode:"ct-chest",amount:-200,occurredAt:"2026-08-11T10:00:00",type:"service_correction"});
    await addRevenue(db,{documentId:xrayDelivery,bookingId:xray,serviceCode:"xray-chest",amount:500,occurredAt:"2026-08-12T10:00:00"});
    await addExpense(db,{id:1001,bookingId:ct,amount:300,occurredAt:"2026-08-10T10:05:00"});
    await addExpense(db,{id:1002,bookingId:military,amount:150,occurredAt:"2026-08-13T10:05:00"});
    await addExpense(db,{id:1003,bookingId:null,amount:90,occurredAt:"2026-08-14T10:05:00"});

    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Margin Org 2','margin-org-2',1)");
    const other=await seedBooking(db,{organizationId:2,code:"MARG99",serviceCode:"ct-chest",serviceTitle:"Other tenant CT"});
    const otherDoc=await seedDocument(db,{organizationId:2,number:"M-D-99",occurredAt:"2026-08-10T10:00:00"});
    await addRevenue(db,{organizationId:2,documentId:otherDoc,bookingId:other,serviceCode:"ct-chest",amount:9000,occurredAt:"2026-08-10T10:00:00"});
    await addExpense(db,{organizationId:2,id:2001,bookingId:other,amount:8000,occurredAt:"2026-08-10T10:05:00"});

    const response=await report(db,admin);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.scope,"material_contribution");
    assert.deepEqual(body.period,{from:"2026-08-01",to:"2026-08-31"});
    assert.equal(body.summary.netRevenue,1300);
    assert.equal(body.summary.linkedMaterialCost,450);
    assert.equal(body.summary.unlinkedMaterialCost,90);
    assert.equal(body.summary.contribution,850);
    assert.equal(body.summary.marginPct,65.4);

    const ctRow=body.rows.find(row=>row.serviceCode==="ct-chest");
    assert.ok(ctRow);assert.equal(ctRow.serviceTitle,"КТ ОГК");assert.equal(ctRow.netRevenue,800);assert.equal(ctRow.materialCost,300);assert.equal(ctRow.contribution,500);assert.equal(ctRow.marginPct,62.5);
    const xrayRow=body.rows.find(row=>row.serviceCode==="xray-chest");
    assert.ok(xrayRow);assert.equal(xrayRow.netRevenue,500);assert.equal(xrayRow.materialCost,0);assert.equal(xrayRow.marginPct,100);
    const militaryRow=body.rows.find(row=>row.serviceCode==="ct-head");
    assert.ok(militaryRow);assert.equal(militaryRow.netRevenue,0);assert.equal(militaryRow.materialCost,150);assert.equal(militaryRow.contribution,-150);assert.equal(militaryRow.marginPct,null);
    assert.ok(!body.rows.some(row=>row.serviceTitle==="Other tenant CT"));

    const auditRow=raw.prepare(`SELECT details_json AS details FROM security_audit_log
      WHERE organization_id=1 AND actor_email='margin-admin@example.com'
        AND action='report_viewed' AND target_id='service_material_margin'
      ORDER BY id DESC LIMIT 1`).get();
    assert.ok(auditRow);
    assert.deepEqual(JSON.parse(auditRow.details),{from:"2026-08-01",to:"2026-08-31",rows:3,scope:"material_contribution"});
    assert.ok(!auditRow.details.includes("MARG"));
    assert.ok(!auditRow.details.includes("Patient"));
  });
});

test("service material margin validates period and stays admin-only",async()=>{
  await withD1(async(db)=>{
    const admin=await seedStaffSession(db,{email:"margin-date-admin@example.com",role:"admin",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"margin-registrar@example.com",role:"registrar",organizationId:1});
    assert.equal((await report(db,registrar)).status,403);
    assert.equal((await report(db,admin,"bad-date","2026-08-31")).status,400);
    assert.equal((await report(db,admin,"2025-01-01","2026-08-31")).status,400);
  });
});
