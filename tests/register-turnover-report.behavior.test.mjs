import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

// Dates are anchored relative to "now" so the report window always contains the
// documents that the payment/refund/storno API calls create with CURRENT_TIMESTAMP.
// A fixed calendar window (e.g. hardcoded August) silently falls out of range once
// the wall clock moves past it, which is what previously broke this suite.
const ISO = (ms) => new Date(ms).toISOString().slice(0, 10);
const NOW = Date.now();
const REPORT_FROM = ISO(NOW - 20 * 86400000);
const REPORT_TO = ISO(NOW + 86400000); // tomorrow: safely covers now-dated documents in any timezone
const IN_PERIOD = ISO(NOW - 5 * 86400000);
const BEFORE_PERIOD = ISO(NOW - 40 * 86400000); // strictly before REPORT_FROM → opening balances

async function seedCompleted(db,{organizationId=1,code,amount=0,category="civilian",performedAt,duration=30,regions=2}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,?,'+380501112233','380501112233','КТ ОГК','ct-chest','ct',?,
       ?,? ,?,'pending',?,0,'confirmed',?,'turnover-doctor@example.com','turnover-tech@example.com')`
  ).bind(
    organizationId,code,`Patient ${code}`,duration,performedAt.slice(0,10),performedAt.slice(11,16),category,amount,regions,
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
  return Number(row.id);
}

async function pay(db,cookie,bookingId,reference) {
  return callWorker(jsonRequest("/api/staff/payments",{
    bookingId,method:"bank_transfer",providerReference:reference,
  },{headers:{cookie}}),db);
}

async function refund(db,cookie,bookingId) {
  return callWorker(new Request("http://localhost/api/staff/payments",{
    method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId}),
  }),db);
}

async function storno(db,cookie,sourceDocumentId) {
  return callWorker(jsonRequest("/api/staff/service-deliveries/corrections",{
    sourceDocumentId,reason:"Сторно для оборотно-сальдового звіту",
  },{headers:{cookie}}),db);
}

async function report(db,cookie,from=REPORT_FROM,to=REPORT_TO) {
  return callWorker(new Request(`http://localhost/api/staff/reports/registers?from=${from}&to=${to}`,{headers:{cookie}}),db);
}

async function seedInventory(db,organizationId=1) {
  const itemResult=await db.prepare(
    `INSERT INTO inventory_items (organization_id,sku,name,category,unit,min_stock,active)
     VALUES (?,'TURN-ITEM','Контраст тестовий','contrast','фл',0,1)`
  ).bind(organizationId).run();
  const itemId=Number(itemResult.meta.last_row_id);
  const lotResult=await db.prepare(
    `INSERT INTO inventory_lots (organization_id,item_id,lot_number,expires_on,supplier)
     VALUES (?,?,'TURN-LOT','2027-12-31','Test Supplier')`
  ).bind(organizationId,itemId).run();
  const lotId=Number(lotResult.meta.last_row_id);
  const warehouse=await db.prepare(
    `SELECT id,code,name FROM warehouses WHERE organization_id=? AND is_default=1 LIMIT 1`
  ).bind(organizationId).first();
  assert.ok(warehouse?.id,"default warehouse must exist");
  for(const movement of [
    {date:`${BEFORE_PERIOD} 09:00:00`,delta:10,type:"receipt"},
    {date:`${IN_PERIOD} 09:00:00`,delta:5,type:"receipt"},
    {date:`${IN_PERIOD} 09:00:00`,delta:-3,type:"writeoff"},
  ]){
    await db.prepare(
      `INSERT INTO inventory_movements
       (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email,created_at)
       VALUES (?,?,?,?,?,?,?,?,'turnover test','turnover@example.com',?)`
    ).bind(organizationId,itemId,lotId,warehouse.id,warehouse.code,warehouse.name,movement.type,movement.delta,movement.date).run();
  }
  return {itemId,warehouse};
}

test("register report derives opening, period turnovers and closing balances from immutable movements",async()=>{
  await withD1(async(db)=>{
    const admin=await seedStaffSession(db,{email:"turnover-admin@example.com",role:"admin",organizationId:1});

    // Previous-period unpaid civilian service creates opening patient debt of 1000.
    await seedCompleted(db,{code:"RD-TURN-JUL",amount:1000,performedAt:`${BEFORE_PERIOD}T10:00:00`,duration:25,regions:1});

    // In-period civilian service is fully neutralized by payment + refund + service storno.
    const civilian=await seedCompleted(db,{code:"RD-TURN-AUG",amount:3000,performedAt:`${IN_PERIOD}T10:00:00`,duration:30,regions:2});
    const paid=await pay(db,admin,civilian,"TURNOVER-PAY");
    assert.equal(paid.status,200);
    const returned=await refund(db,admin,civilian);
    assert.equal(returned.status,200);
    const sourceId=await serviceDocumentId(db,1,civilian);
    const reversed=await storno(db,admin,sourceId);
    assert.equal(reversed.status,201);

    // Military service has operational movements but no revenue/settlement charge.
    await seedCompleted(db,{code:"RD-TURN-MIL",amount:5000,category:"military",performedAt:`${IN_PERIOD}T12:00:00`,duration:20,regions:1});
    const {itemId,warehouse}=await seedInventory(db);

    const response=await report(db,admin);
    assert.equal(response.status,200);
    const body=await response.json();

    assert.deepEqual(body.period,{from:REPORT_FROM,to:REPORT_TO});
    assert.equal(body.registers.revenue.increase,3000);
    assert.equal(body.registers.revenue.decrease,3000);
    assert.equal(body.registers.revenue.net,0);
    assert.equal(body.registers.cash.increase,3000);
    assert.equal(body.registers.cash.decrease,3000);
    assert.equal(body.registers.cash.net,0);

    assert.equal(body.registers.settlements.opening,1000);
    assert.equal(body.registers.settlements.increase,6000); // service charge + refund
    assert.equal(body.registers.settlements.decrease,6000); // payment + service storno
    assert.equal(body.registers.settlements.net,0);
    assert.equal(body.registers.settlements.closing,1000);

    assert.equal(body.registers.services.increase,2);
    assert.equal(body.registers.services.decrease,1);
    assert.equal(body.registers.services.net,1);
    assert.equal(body.registers.services.regionsNet,1);
    assert.equal(body.registers.equipment.increase,50);
    assert.equal(body.registers.equipment.decrease,30);
    assert.equal(body.registers.equipment.net,20);
    assert.equal(body.registers.staff.increase,4);
    assert.equal(body.registers.staff.decrease,2);
    assert.equal(body.registers.staff.net,2);

    const revenue=body.breakdowns.revenueByService.find(row=>row.serviceCode==="ct-chest");
    assert.equal(revenue.accrued,3000);
    assert.equal(revenue.reversed,3000);
    assert.equal(revenue.net,0);
    const cash=body.breakdowns.cashByMethod.find(row=>row.method==="bank_transfer");
    assert.equal(cash.incoming,3000);
    assert.equal(cash.outgoing,3000);
    assert.equal(cash.net,0);
    const equipment=body.breakdowns.equipment.find(row=>row.equipmentId==="ct");
    assert.equal(equipment.netMinutes,20);
    assert.ok(body.breakdowns.staff.every(row=>row.net===1));

    const stock=body.breakdowns.inventory.find(row=>row.itemId===itemId);
    assert.equal(stock.opening,10);
    assert.equal(stock.incoming,5);
    assert.equal(stock.outgoing,3);
    assert.equal(stock.closing,12);

    const warehouseStock=body.breakdowns.inventoryByWarehouse.find(row=>row.itemId===itemId&&row.warehouseId===warehouse.id);
    assert.ok(warehouseStock);
    assert.equal(warehouseStock.warehouseCode,"MAIN");
    assert.equal(warehouseStock.warehouseName,"Основний склад");
    assert.equal(warehouseStock.opening,10);
    assert.equal(warehouseStock.incoming,5);
    assert.equal(warehouseStock.outgoing,3);
    assert.equal(warehouseStock.closing,12);
  });
});

test("register report is tenant scoped and excludes another organization movements",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Turnover Org 2','turnover-org-2',1)");
    const org1=await seedStaffSession(db,{email:"turnover-org1@example.com",role:"admin",organizationId:1});
    const org2=await seedStaffSession(db,{email:"turnover-org2@example.com",role:"admin",organizationId:2});
    await seedCompleted(db,{organizationId:1,code:"RD-TURN-ORG1",amount:1200,performedAt:`${IN_PERIOD}T10:00:00`,regions:1});
    await seedCompleted(db,{organizationId:2,code:"RD-TURN-ORG2",amount:8800,performedAt:`${IN_PERIOD}T10:00:00`,regions:1});

    const one=await report(db,org1);const oneBody=await one.json();
    const two=await report(db,org2);const twoBody=await two.json();
    assert.equal(oneBody.registers.revenue.net,1200);
    assert.equal(twoBody.registers.revenue.net,8800);
  });
});

test("register report rejects invalid or excessive periods",async()=>{
  await withD1(async(db)=>{
    const admin=await seedStaffSession(db,{email:"turnover-period@example.com",role:"admin",organizationId:1});
    assert.equal((await report(db,admin,"2026-08-31","2026-08-01")).status,400);
    assert.equal((await report(db,admin,"2025-01-01","2026-08-31")).status,400);
    assert.equal((await report(db,admin,"bad","2026-08-31")).status,400);
  });
});

test("register report remains restricted to report authority",async()=>{
  await withD1(async(db)=>{
    const registrar=await seedStaffSession(db,{email:"turnover-registrar@example.com",role:"registrar",organizationId:1});
    const doctor=await seedStaffSession(db,{email:"turnover-doctor-role@example.com",role:"radiologist",organizationId:1});
    assert.equal((await report(db,registrar)).status,403);
    assert.equal((await report(db,doctor)).status,403);
  });
});
