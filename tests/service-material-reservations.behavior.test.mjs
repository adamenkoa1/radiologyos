import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

async function seedStock(db,raw,{organizationId=1,sku="RES-MAT",quantity=10}={}){
  const itemResult=await db.prepare(`INSERT INTO inventory_items
    (organization_id,sku,name,category,unit,min_stock,active)
    VALUES (?,?,'Reservation material','other','шт',0,1)`).bind(organizationId,sku).run();
  const itemId=Number(itemResult.meta.last_row_id);
  const warehouse=raw.prepare(`SELECT id,code,name FROM warehouses
    WHERE organization_id=? AND is_default=1 LIMIT 1`).get(organizationId);
  assert.ok(warehouse?.id);
  const lotResult=raw.prepare(`INSERT INTO inventory_lots
    (organization_id,item_id,lot_number,expires_on,supplier)
    VALUES (?,?,'RES-LOT','','')`).run(organizationId,itemId);
  const lotId=Number(lotResult.lastInsertRowid);
  raw.prepare(`INSERT INTO inventory_movements
    (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
     movement_type,quantity_delta,reason,actor_email)
    VALUES (?,?,?,?,?,?,'receipt',?,'legacy stock seed','test')`)
    .run(organizationId,itemId,lotId,warehouse.id,warehouse.code,warehouse.name,quantity);
  return {itemId,lotId,warehouseId:Number(warehouse.id),warehouseCode:warehouse.code,warehouseName:warehouse.name};
}

async function requirement(db,{organizationId=1,serviceCode="ct-reservation",itemId,warehouseId,quantity=2,active=1}={}){
  const result=await db.prepare(`INSERT INTO service_material_requirements
    (organization_id,service_code,item_id,warehouse_id,quantity,active,created_by,updated_by)
    VALUES (?,?,?,?,?,?,?,?)`).bind(organizationId,serviceCode,itemId,warehouseId,quantity,active,"materials-admin@example.com","materials-admin@example.com").run();
  return Number(result.meta.last_row_id);
}

let bookingSeq=0;
async function booking(db,{organizationId=1,serviceCode="ct-reservation",status="confirmed",date="2026-11-01",time="10:00"}={}){
  bookingSeq+=1;
  const patientId=`PAT-RES-${organizationId}-${bookingSeq}`;
  const phone=`38050${String(7000000+bookingSeq).padStart(7,"0")}`;
  await db.prepare(`INSERT INTO patient_profiles
    (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES (?,?,?,'Reservation Patient','test')`).bind(patientId,organizationId,phone).run();
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (?,?,'Reservation Patient',?,?,?,'1980-01-02','КТ резерв',?,'ct',30,?,?,'civilian','pending',2500,0,?,1,
      'res-doctor@example.com','res-tech@example.com')`)
    .bind(organizationId,`RD-RES-${organizationId}-${bookingSeq}`,`+${phone}`,phone,patientId,serviceCode,date,time,status).run();
  return Number(result.meta.last_row_id);
}

function appointment(raw,organizationId,bookingId){
  return raw.prepare(`SELECT a.document_id AS documentId,a.appointment_version AS version,d.state
    FROM appointment_details a JOIN business_documents d
      ON d.id=a.document_id AND d.organization_id=a.organization_id
    WHERE a.organization_id=? AND a.booking_id=? ORDER BY a.appointment_version DESC LIMIT 1`).get(organizationId,bookingId);
}
function movements(raw,organizationId,bookingId){
  return raw.prepare(`SELECT id,appointment_document_id AS appointmentDocumentId,requirement_id AS requirementId,
      service_code AS serviceCode,item_id AS itemId,warehouse_id AS warehouseId,movement_type AS movementType,
      quantity_delta AS quantityDelta,actor_email AS actorEmail
    FROM inventory_reservation_movements
    WHERE organization_id=? AND booking_id=? ORDER BY id`).all(organizationId,bookingId);
}
function reservationBalance(raw,organizationId,warehouseId,itemId){
  return Number(raw.prepare(`SELECT COALESCE(SUM(quantity_delta),0) AS quantity
    FROM inventory_reservation_movements
    WHERE organization_id=? AND warehouse_id=? AND item_id=?`).get(organizationId,warehouseId,itemId).quantity);
}

test("future Appointment reserves active service material requirement without choosing a lot",async()=>{
  await withD1(async(db,raw)=>{
    const stock=await seedStock(db,raw,{quantity:10});
    const requirementId=await requirement(db,{itemId:stock.itemId,warehouseId:stock.warehouseId,quantity:2});
    const bookingId=await booking(db);
    const a=appointment(raw,1,bookingId);assert.ok(a?.documentId);assert.equal(a.state,"posted");
    const rows=movements(raw,1,bookingId);assert.equal(rows.length,1);
    assert.equal(rows[0].appointmentDocumentId,a.documentId);assert.equal(rows[0].requirementId,requirementId);
    assert.equal(rows[0].serviceCode,"ct-reservation");assert.equal(rows[0].itemId,stock.itemId);
    assert.equal(rows[0].warehouseId,stock.warehouseId);assert.equal(rows[0].movementType,"reserve");
    assert.equal(Number(rows[0].quantityDelta),2);assert.equal(rows[0].actorEmail,"system:schedule");
    assert.equal(reservationBalance(raw,1,stock.warehouseId,stock.itemId),2);
    assert.equal(Object.hasOwn(rows[0],"lotId"),false,"reservation must stay item+warehouse scoped, not lot-valued");
  });
});

test("reservation availability is tenant+warehouse+item scoped and booking creation is atomic on shortage",async()=>{
  await withD1(async(db,raw)=>{
    const stock=await seedStock(db,raw,{sku:"RES-LIMIT",quantity:3});
    await requirement(db,{itemId:stock.itemId,warehouseId:stock.warehouseId,quantity:2});
    const first=await booking(db,{time:"10:30"});
    assert.equal(reservationBalance(raw,1,stock.warehouseId,stock.itemId),2);
    const before=Number(raw.prepare("SELECT COUNT(*) AS n FROM bookings WHERE organization_id=1").get().n);
    await assert.rejects(booking(db,{time:"11:00"}),/inventory_reservation_insufficient_stock/);
    assert.equal(Number(raw.prepare("SELECT COUNT(*) AS n FROM bookings WHERE organization_id=1").get().n),before);
    assert.equal(movements(raw,1,first).length,1);
    assert.equal(reservationBalance(raw,1,stock.warehouseId,stock.itemId),2);
  });
});

test("reschedule releases the old Appointment and reserves the replacement exactly once",async()=>{
  await withD1(async(db,raw)=>{
    const stock=await seedStock(db,raw,{sku:"RES-REPLAN",quantity:5});
    await requirement(db,{itemId:stock.itemId,warehouseId:stock.warehouseId,quantity:2});
    const bookingId=await booking(db,{time:"12:00"});
    const v1=appointment(raw,1,bookingId);assert.equal(v1.version,1);
    await db.prepare("UPDATE bookings SET desired_date='2026-11-02',desired_time='13:30' WHERE organization_id=1 AND id=?").bind(bookingId).run();
    const v2=appointment(raw,1,bookingId);assert.equal(v2.version,2);assert.notEqual(v2.documentId,v1.documentId);
    const rows=movements(raw,1,bookingId);assert.equal(rows.length,3);
    assert.deepEqual(rows.map(x=>[x.appointmentDocumentId,x.movementType,Number(x.quantityDelta)]),[
      [v1.documentId,"reserve",2],[v1.documentId,"release",-2],[v2.documentId,"reserve",2],
    ]);
    assert.equal(reservationBalance(raw,1,stock.warehouseId,stock.itemId),2);
  });
});

test("cancellation and completion release planning reservations without synthesizing inventory writeoff",async()=>{
  await withD1(async(db,raw)=>{
    const stock=await seedStock(db,raw,{sku:"RES-RELEASE",quantity:10});
    await requirement(db,{itemId:stock.itemId,warehouseId:stock.warehouseId,quantity:2});

    const cancelled=await booking(db,{time:"14:00"});
    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?").bind(cancelled).run();
    assert.deepEqual(movements(raw,1,cancelled).map(x=>[x.movementType,Number(x.quantityDelta)]),[["reserve",2],["release",-2]]);

    const completed=await booking(db,{time:"15:00"});
    const inventoryBefore=Number(raw.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE organization_id=1").get().n);
    await db.prepare("UPDATE bookings SET status='completed',performed_at='2026-11-01T15:05:00' WHERE organization_id=1 AND id=?").bind(completed).run();
    assert.deepEqual(movements(raw,1,completed).map(x=>[x.movementType,Number(x.quantityDelta)]),[["reserve",2],["release",-2]]);
    assert.equal(Number(raw.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE organization_id=1").get().n),inventoryBefore,
      "reservation release must not invent physical consumption");
    assert.equal(reservationBalance(raw,1,stock.warehouseId,stock.itemId),0);
  });
});

test("physical negative stock movement cannot consume quantity held by active reservations",async()=>{
  await withD1(async(db,raw)=>{
    const stock=await seedStock(db,raw,{sku:"RES-FLOOR",quantity:5});
    await requirement(db,{itemId:stock.itemId,warehouseId:stock.warehouseId,quantity:2});
    await booking(db,{time:"16:00"});
    assert.equal(reservationBalance(raw,1,stock.warehouseId,stock.itemId),2);
    assert.throws(()=>raw.prepare(`INSERT INTO inventory_movements
      (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email)
      VALUES (1,?,?,?,?,?,'writeoff',-4,'manual attempt','test')`)
      .run(stock.itemId,stock.lotId,stock.warehouseId,stock.warehouseCode,stock.warehouseName),/inventory_reserved_stock_violation/);
    assert.equal(Number(raw.prepare(`SELECT COALESCE(SUM(quantity_delta),0) AS q FROM inventory_movements
      WHERE organization_id=1 AND warehouse_id=? AND item_id=?`).get(stock.warehouseId,stock.itemId).q),5);
  });
});

test("requirements and reservation movements fail closed on tenant forgery and remain immutable",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Reservation Org 2','reservation-org-2',1)");
    const one=await seedStock(db,raw,{organizationId:1,sku:"RES-TENANT-1",quantity:5});
    const two=await seedStock(db,raw,{organizationId:2,sku:"RES-TENANT-2",quantity:5});
    await assert.rejects(requirement(db,{organizationId:1,itemId:two.itemId,warehouseId:one.warehouseId,quantity:1}),/service_material_requirement_item_tenant_mismatch/);
    await assert.rejects(requirement(db,{organizationId:1,itemId:one.itemId,warehouseId:two.warehouseId,quantity:1}),/service_material_requirement_warehouse_tenant_mismatch/);
    const requirementId=await requirement(db,{organizationId:1,itemId:one.itemId,warehouseId:one.warehouseId,quantity:1});
    const bookingId=await booking(db,{organizationId:1,time:"17:00"});const row=movements(raw,1,bookingId)[0];assert.ok(row);
    assert.throws(()=>raw.prepare("UPDATE service_material_requirements SET quantity=99 WHERE id=?").run(requirementId),/service_material_requirement_immutable/);
    assert.throws(()=>raw.prepare("DELETE FROM service_material_requirements WHERE id=?").run(requirementId),/service_material_requirement_delete_forbidden/);
    assert.throws(()=>raw.prepare("UPDATE inventory_reservation_movements SET quantity_delta=99 WHERE id=?").run(row.id),/inventory_reservation_immutable/);
    assert.throws(()=>raw.prepare("DELETE FROM inventory_reservation_movements WHERE id=?").run(row.id),/inventory_reservation_immutable/);
  });
});

test("0099 is future-only and business core declares Appointment as reservation registrar",async()=>{
  const migration=await readFile(new URL("../drizzle/0099_service_material_reservations.sql",import.meta.url),"utf8");
  const core=await readFile(new URL("../lib/business-core.ts",import.meta.url),"utf8");
  assert.match(migration,/AFTER INSERT ON `appointment_details`/);
  assert.match(migration,/Actual material consumption\/write-off remains a/);
  const beforeTriggers=migration.split("-- Requirements are versioned master data.")[0];
  assert.doesNotMatch(beforeTriggers,/INSERT\s+INTO\s+`?inventory_reservation_movements`?/i);
  assert.match(core,/appointment:\s*\["inventory_reservations"\]/);
});
