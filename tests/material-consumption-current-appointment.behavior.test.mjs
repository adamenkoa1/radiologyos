import assert from "node:assert/strict";
import test from "node:test";
import { getMaterialConsumption,listMaterialConsumption } from "../lib/material-consumption.ts";
import { withD1 } from "./helpers/d1.mjs";

async function seedStock(db,raw){
  const itemResult=await db.prepare(`INSERT INTO inventory_items
    (organization_id,sku,name,category,unit,min_stock,active)
    VALUES (1,'CONS-CURRENT','Current appointment material','other','шт',0,1)`).run();
  const itemId=Number(itemResult.meta.last_row_id);
  const warehouse=raw.prepare(`SELECT id,code,name FROM warehouses
    WHERE organization_id=1 AND is_default=1 LIMIT 1`).get();
  assert.ok(warehouse?.id);
  const lotResult=raw.prepare(`INSERT INTO inventory_lots
    (organization_id,item_id,lot_number,expires_on,supplier)
    VALUES (1,?,'CONS-CURRENT-LOT','','')`).run(itemId);
  const lotId=Number(lotResult.lastInsertRowid);
  raw.prepare(`INSERT INTO inventory_movements
    (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
     movement_type,quantity_delta,reason,actor_email)
    VALUES (1,?,?,?,?,?,'receipt',4,'test stock','test')`)
    .run(itemId,lotId,warehouse.id,warehouse.code,warehouse.name);
  return {itemId,lotId,warehouseId:Number(warehouse.id),warehouseCode:warehouse.code,warehouseName:warehouse.name};
}

async function seedBooking(db,{itemId,warehouseId}){
  await db.prepare(`INSERT INTO service_material_requirements
    (organization_id,service_code,item_id,warehouse_id,quantity,active,created_by,updated_by)
    VALUES (1,'ct-current',?,?,2,1,'test','test')`).bind(itemId,warehouseId).run();
  await db.prepare(`INSERT INTO patient_profiles
    (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES ('PAT-CONS-CURRENT',1,'380501234567','Current Patient','test')`).run();
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (1,'CONS-CURRENT','Current Patient','+380501234567','380501234567','PAT-CONS-CURRENT','1980-01-02',
      'КТ current','ct-current','ct',30,'2026-12-01','10:00','civilian','pending',2500,0,'confirmed',1,
      'doctor@example.com','tech@example.com')`).run();
  return Number(result.meta.last_row_id);
}

function appointment(raw,bookingId){
  return raw.prepare(`SELECT a.document_id AS documentId,a.appointment_version AS version,d.state
    FROM appointment_details a
    JOIN business_documents d ON d.id=a.document_id AND d.organization_id=a.organization_id
    WHERE a.organization_id=1 AND a.booking_id=?
    ORDER BY a.appointment_version DESC LIMIT 1`).get(bookingId);
}

function reserve(raw,bookingId,appointmentDocumentId){
  return raw.prepare(`SELECT id,quantity_delta AS quantityDelta FROM inventory_reservation_movements
    WHERE organization_id=1 AND booking_id=? AND appointment_document_id=? AND movement_type='reserve'
    LIMIT 1`).get(bookingId,appointmentDocumentId);
}

test("rescheduled completed booking exposes only current Appointment reservation and D1 rejects stale reserve",async()=>{
  await withD1(async(db,raw)=>{
    const stock=await seedStock(db,raw);
    const bookingId=await seedBooking(db,stock);

    const v1=appointment(raw,bookingId);assert.equal(v1.version,1);assert.equal(v1.state,"posted");
    const oldReserve=reserve(raw,bookingId,v1.documentId);assert.ok(oldReserve?.id);assert.equal(Number(oldReserve.quantityDelta),2);

    await db.prepare(`UPDATE bookings SET desired_date='2026-12-02',desired_time='11:30'
      WHERE organization_id=1 AND id=?`).bind(bookingId).run();
    const v2=appointment(raw,bookingId);assert.equal(v2.version,2);assert.equal(v2.state,"posted");assert.notEqual(v2.documentId,v1.documentId);
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE organization_id=1 AND id=?").get(v1.documentId).state,"reversed");
    const currentReserve=reserve(raw,bookingId,v2.documentId);assert.ok(currentReserve?.id);assert.notEqual(currentReserve.id,oldReserve.id);

    await db.prepare(`UPDATE bookings SET status='completed',performed_at='2026-12-02T11:35:00'
      WHERE organization_id=1 AND id=?`).bind(bookingId).run();
    const lifecycle=raw.prepare(`SELECT appointment_document_id AS appointmentDocumentId,movement_type AS movementType,quantity_delta AS quantityDelta
      FROM inventory_reservation_movements WHERE organization_id=1 AND booking_id=? ORDER BY id`).all(bookingId);
    assert.deepEqual(lifecycle.map(row=>[row.appointmentDocumentId,row.movementType,Number(row.quantityDelta)]),[
      [v1.documentId,"reserve",2],[v1.documentId,"release",-2],
      [v2.documentId,"reserve",2],[v2.documentId,"release",-2],
    ]);

    assert.equal(await getMaterialConsumption(db,1,Number(oldReserve.id)),null,"superseded Appointment reserve must not be executable");
    const current=await getMaterialConsumption(db,1,Number(currentReserve.id));assert.ok(current);assert.equal(current.reservationId,Number(currentReserve.id));
    const listed=await listMaterialConsumption(db,1);
    assert.equal(listed.some(row=>row.reservationId===Number(oldReserve.id)),false);
    assert.equal(listed.some(row=>row.reservationId===Number(currentReserve.id)),true);

    const staleDoc=raw.prepare(`INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by)
      VALUES (1,'inventory_writeoff','CONS-STALE','2026-12-02T11:40:00','draft','stale test','test')`).run();
    assert.throws(()=>raw.prepare(`INSERT INTO inventory_document_lines
      (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
       lot_number,expires_on,supplier,quantity,reason,booking_id,reservation_movement_id)
      VALUES (1,?,1,?,?,?,?,?,'CONS-CURRENT-LOT','','',1,'stale attempt',?,?)`)
      .run(Number(staleDoc.lastInsertRowid),stock.itemId,stock.lotId,stock.warehouseId,stock.warehouseCode,stock.warehouseName,
        bookingId,Number(oldReserve.id)),/inventory_consumption_reservation_invalid/);

    const currentDoc=raw.prepare(`INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by)
      VALUES (1,'inventory_writeoff','CONS-CURRENT-OK','2026-12-02T11:41:00','draft','current test','test')`).run();
    assert.doesNotThrow(()=>raw.prepare(`INSERT INTO inventory_document_lines
      (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
       lot_number,expires_on,supplier,quantity,reason,booking_id,reservation_movement_id)
      VALUES (1,?,1,?,?,?,?,?,'CONS-CURRENT-LOT','','',1,'current attempt',?,?)`)
      .run(Number(currentDoc.lastInsertRowid),stock.itemId,stock.lotId,stock.warehouseId,stock.warehouseCode,stock.warehouseName,
        bookingId,Number(currentReserve.id)));
  });
});
