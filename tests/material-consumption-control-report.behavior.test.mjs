import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,seedStaffSession,withD1 } from "./helpers/d1.mjs";

function dropInsertGuards(raw,table){
  const rows=raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND upper(sql) LIKE '%BEFORE INSERT%'").all(table);
  for(const row of rows){
    const name=String(row.name).replaceAll('"','""');
    raw.exec(`DROP TRIGGER "${name}"`);
  }
}

async function report(db,cookie,from="2026-08-01",to="2026-08-31"){
  return callWorker(new Request(`http://localhost/api/staff/reports/material-consumption-control?from=${from}&to=${to}`,{headers:{cookie}}),db);
}

async function seedBooking(db,{code,serviceCode,serviceTitle,performedAt}){
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,status,payment_amount,performed_at)
    VALUES (1,?,?,? ,?,'1980-01-02',?,?,'ct',30,'2026-08-10','10:00','civilian','completed',0,?)`)
    .bind(code,`Patient ${code}`,`+38050${code.slice(-6)}`,`38050${code.slice(-6)}`,serviceTitle,serviceCode,performedAt).run();
  return Number(result.meta.last_row_id);
}

async function appointment(db,{number,state="posted",occurredAt="2026-08-10T09:00:00"}){
  const result=await db.prepare(`INSERT INTO business_documents
    (organization_id,document_type,number,occurred_at,state,created_by,posted_by,posted_at)
    VALUES (1,'appointment',?,?,?,?,?,?)`)
    .bind(number,occurredAt,state,'control-test','control-test',occurredAt).run();
  return Number(result.meta.last_row_id);
}

async function requirement(db,{serviceCode,itemId,warehouseId,quantity}){
  const result=await db.prepare(`INSERT INTO service_material_requirements
    (organization_id,service_code,item_id,warehouse_id,quantity,active,created_by,updated_by)
    VALUES (1,?,?,?,?,1,'control-test','control-test')`).bind(serviceCode,itemId,warehouseId,quantity).run();
  return Number(result.meta.last_row_id);
}

async function reservePair(db,{appointmentDocumentId,bookingId,requirementId,serviceCode,itemId,warehouseId,quantity}){
  const reserve=await db.prepare(`INSERT INTO inventory_reservation_movements
    (organization_id,appointment_document_id,booking_id,requirement_id,service_code,item_id,warehouse_id,movement_type,quantity_delta,actor_email,occurred_at)
    VALUES (1,?,?,?,?,?,?,'reserve',?,'control-test','2026-08-10T09:00:00')`)
    .bind(appointmentDocumentId,bookingId,requirementId,serviceCode,itemId,warehouseId,quantity).run();
  await db.prepare(`INSERT INTO inventory_reservation_movements
    (organization_id,appointment_document_id,booking_id,requirement_id,service_code,item_id,warehouse_id,movement_type,quantity_delta,actor_email,occurred_at)
    VALUES (1,?,?,?,?,?,?,'release',?,'control-test','2026-08-10T10:30:00')`)
    .bind(appointmentDocumentId,bookingId,requirementId,serviceCode,itemId,warehouseId,-quantity).run();
  return Number(reserve.meta.last_row_id);
}

async function writeoffLine(db,raw,{reservationId,bookingId,itemId,lotId,warehouse,quantity,state,number,occurredAt}){
  const doc=await db.prepare(`INSERT INTO business_documents
    (organization_id,document_type,number,occurred_at,state,created_by,posted_by,posted_at)
    VALUES (1,'inventory_writeoff',?,?,?,?,?,?)`)
    .bind(number,occurredAt,state,'control-test',state==='posted'?'control-test':'',state==='posted'?occurredAt:'').run();
  const documentId=Number(doc.meta.last_row_id);
  const line=await db.prepare(`INSERT INTO inventory_document_lines
    (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
     lot_number,expires_on,supplier,quantity,reason,booking_id,reservation_movement_id)
    VALUES (1,?,1,?,?,?,?,?,'CONTROL-LOT','','',?,'control',?,?)`)
    .bind(documentId,itemId,lotId,warehouse.id,warehouse.code,warehouse.name,quantity,bookingId,reservationId).run();
  const lineId=Number(line.meta.last_row_id);
  if(state==='posted'){
    await db.prepare(`INSERT INTO inventory_movements
      (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email,occurred_at,document_id,document_line_id)
      VALUES (1,?,?,?,?,?,'writeoff',?,'control','control-test',?,?,?)`)
      .bind(itemId,lotId,warehouse.id,warehouse.code,warehouse.name,-quantity,occurredAt,documentId,lineId).run();
  }
  return {documentId,lineId};
}

test("material consumption control uses current Appointment plan and physical posted writeoff fact as of report time",async()=>{
  await withD1(async(db,raw)=>{
    dropInsertGuards(raw,"inventory_reservation_movements");
    dropInsertGuards(raw,"inventory_document_lines");
    dropInsertGuards(raw,"inventory_movements");

    const admin=await seedStaffSession(db,{email:"control-admin@example.com",role:"admin",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"control-registrar@example.com",role:"registrar",organizationId:1});
    const warehouse=raw.prepare("SELECT id,code,name FROM warehouses WHERE organization_id=1 AND is_default=1 LIMIT 1").get();
    assert.ok(warehouse?.id);
    const itemResult=await db.prepare(`INSERT INTO inventory_items
      (organization_id,sku,name,category,unit,min_stock,active) VALUES (1,'CTRL-MAT','Контраст','other','мл',0,1)`).run();
    const itemId=Number(itemResult.meta.last_row_id);
    const lotResult=await db.prepare(`INSERT INTO inventory_lots
      (organization_id,item_id,lot_number,expires_on,supplier) VALUES (1,?,'CONTROL-LOT','','')`).bind(itemId).run();
    const lotId=Number(lotResult.meta.last_row_id);

    const ct=await seedBooking(db,{code:"CTRL01",serviceCode:"ct-control",serviceTitle:"КТ контроль",performedAt:"2026-08-10T10:15:00"});
    const ctRequirement=await requirement(db,{serviceCode:"ct-control",itemId,warehouseId:warehouse.id,quantity:3});
    const staleAppointment=await appointment(db,{number:"A-OLD",state:"reversed"});
    await reservePair(db,{appointmentDocumentId:staleAppointment,bookingId:ct,requirementId:ctRequirement,serviceCode:"ct-control",itemId,warehouseId:warehouse.id,quantity:3});
    const currentAppointment=await appointment(db,{number:"A-CURRENT",state:"posted"});
    const currentReserve=await reservePair(db,{appointmentDocumentId:currentAppointment,bookingId:ct,requirementId:ctRequirement,serviceCode:"ct-control",itemId,warehouseId:warehouse.id,quantity:3});

    // Physical posting happens after the service-period boundary; the report still shows it because
    // the period selects performed services and fact is the current posted ledger state.
    await writeoffLine(db,raw,{reservationId:currentReserve,bookingId:ct,itemId,lotId,warehouse,quantity:2,state:"posted",number:"W-POSTED",occurredAt:"2026-09-05T12:00:00"});
    await writeoffLine(db,raw,{reservationId:currentReserve,bookingId:ct,itemId,lotId,warehouse,quantity:1,state:"draft",number:"W-DRAFT",occurredAt:"2026-09-06T12:00:00"});

    const xray=await seedBooking(db,{code:"CTRL02",serviceCode:"xray-control",serviceTitle:"Рентген контроль",performedAt:"2026-08-11T10:15:00"});
    const xrayRequirement=await requirement(db,{serviceCode:"xray-control",itemId,warehouseId:warehouse.id,quantity:2});
    const xrayAppointment=await appointment(db,{number:"A-XRAY",state:"posted",occurredAt:"2026-08-11T09:00:00"});
    await reservePair(db,{appointmentDocumentId:xrayAppointment,bookingId:xray,requirementId:xrayRequirement,serviceCode:"xray-control",itemId,warehouseId:warehouse.id,quantity:2});

    const response=await report(db,admin);assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.scope,"material_consumption_control");
    assert.deepEqual(body.period,{from:"2026-08-01",to:"2026-08-31"});
    assert.equal(body.summary.completedBookings,2);
    assert.equal(body.summary.reservationFacts,2,"reversed Appointment reserve must not double the plan");
    assert.equal(body.summary.fullyPosted,0);
    assert.equal(body.summary.withDraft,1);
    assert.equal(body.summary.needsAllocation,1);
    assert.equal(body.summary.rowCount,2);

    const ctRow=body.rows.find(row=>row.serviceCode==="ct-control");assert.ok(ctRow);
    assert.equal(ctRow.plannedQuantity,3);assert.equal(ctRow.postedQuantity,2);assert.equal(ctRow.draftQuantity,1);
    assert.equal(ctRow.unpostedQuantity,1);assert.equal(ctRow.unallocatedQuantity,0);assert.equal(ctRow.coveragePct,66.7);
    const xrayRow=body.rows.find(row=>row.serviceCode==="xray-control");assert.ok(xrayRow);
    assert.equal(xrayRow.plannedQuantity,2);assert.equal(xrayRow.postedQuantity,0);assert.equal(xrayRow.draftQuantity,0);
    assert.equal(xrayRow.unallocatedQuantity,2);assert.equal(xrayRow.coveragePct,0);

    assert.equal((await report(db,registrar)).status,403);
    assert.equal((await report(db,admin,"bad-date","2026-08-31")).status,400);
    assert.equal((await report(db,admin,"2025-01-01","2026-08-31")).status,400);

    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Control Org 2','control-org-2',1)");
    const admin2=await seedStaffSession(db,{email:"control-org2@example.com",role:"admin",organizationId:2});
    const org2Response=await report(db,admin2);assert.equal(org2Response.status,200);
    assert.equal((await org2Response.json()).summary.reservationFacts,0);

    const auditRow=raw.prepare(`SELECT details_json AS details FROM security_audit_log
      WHERE organization_id=1 AND actor_email='control-admin@example.com'
        AND action='report_viewed' AND target_id='material_consumption_control'
      ORDER BY id DESC LIMIT 1`).get();
    assert.ok(auditRow);assert.equal(auditRow.details.includes("CTRL"),false);assert.equal(auditRow.details.includes("Patient"),false);
  });
});
