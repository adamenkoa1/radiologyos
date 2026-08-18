import assert from "node:assert/strict";
import test from "node:test";
import { freshDb } from "./helpers/d1.mjs";
import { createInventoryCount,getInventoryCount,postInventoryCount } from "../lib/inventory-counts.ts";

let seq=0;
async function seedStock(db,raw,{organizationId=1,quantity=10,sku}={}){
  seq+=1;
  const code=sku||`COUNT-${organizationId}-${seq}`;
  const itemResult=await db.prepare(`INSERT INTO inventory_items
    (organization_id,sku,name,category,unit,min_stock,active)
    VALUES (?,?,?,'other','шт',0,1)`).bind(organizationId,code,`Count item ${seq}`).run();
  const itemId=Number(itemResult.meta.last_row_id);
  const warehouse=raw.prepare(`SELECT id,code,name FROM warehouses
    WHERE organization_id=? AND is_default=1 LIMIT 1`).get(organizationId);
  assert.ok(warehouse?.id);
  const lotResult=raw.prepare(`INSERT INTO inventory_lots
    (organization_id,item_id,lot_number,expires_on,supplier)
    VALUES (?,?,?,'','')`).run(organizationId,itemId,`COUNT-LOT-${seq}`);
  const lotId=Number(lotResult.lastInsertRowid);
  if(quantity!==0){
    raw.prepare(`INSERT INTO inventory_movements
      (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
       movement_type,quantity_delta,reason,actor_email)
      VALUES (?,?,?,?,?,?,'receipt',?,'legacy stock seed','test')`)
      .run(organizationId,itemId,lotId,warehouse.id,warehouse.code,warehouse.name,quantity);
  }
  return{itemId,lotId,warehouseId:Number(warehouse.id),warehouseCode:warehouse.code,warehouseName:warehouse.name};
}
function stock(raw,organizationId,warehouseId,lotId){
  return Number(raw.prepare(`SELECT COALESCE(SUM(quantity_delta),0) AS q FROM inventory_movements
    WHERE organization_id=? AND warehouse_id=? AND lot_id=?`).get(organizationId,warehouseId,lotId).q);
}

async function seedReservation(db,raw,{itemId,warehouseId,quantity=2,serviceCode}={}){
  seq+=1;const service=serviceCode||`count-res-${seq}`;
  await db.prepare(`INSERT INTO service_material_requirements
    (organization_id,service_code,item_id,warehouse_id,quantity,active,created_by,updated_by)
    VALUES (1,?,?,?,?,1,'count-test','count-test')`).bind(service,itemId,warehouseId,quantity).run();
  const patientId=`PAT-COUNT-${seq}`,phone=`38067${String(7100000+seq).padStart(7,"0")}`;
  await db.prepare(`INSERT INTO patient_profiles
    (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES (?,1,?,'Count Patient','count-test')`).bind(patientId,phone).run();
  await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (1,?,'Count Patient',?,?,?,'1980-01-02','КТ інвентаризація',?,'ct',30,'2026-11-01','18:00',
      'civilian','pending',0,0,'confirmed',1,'count-doctor@example.com','count-tech@example.com')`)
    .bind(`COUNT-BKG-${seq}`,`+${phone}`,phone,patientId,service).run();
}

test("inventory count posts negative, zero-to-zero and positive discrepancies as exact ledger facts",async()=>{
  const {db,raw,close}=await freshDb();try{
    const a=await seedStock(db,raw,{quantity:10});
    const b=await seedStock(db,raw,{quantity:5});
    const c=await seedStock(db,raw,{quantity:0});
    const d=await seedStock(db,raw,{quantity:4});
    const created=await createInventoryCount(db,{organizationId:1,actorEmail:"counter@example.com",lines:[
      {lotId:a.lotId,warehouseId:a.warehouseId,countedQuantity:7,reason:"shortage"},
      {lotId:b.lotId,warehouseId:b.warehouseId,countedQuantity:0,reason:"empty shelf"},
      {lotId:c.lotId,warehouseId:c.warehouseId,countedQuantity:2,reason:"found stock"},
      {lotId:d.lotId,warehouseId:d.warehouseId,countedQuantity:4,reason:"matched"},
    ]});
    assert.deepEqual(created.lines.map(x=>[Number(x.bookQuantity),Number(x.countedQuantity),Number(x.discrepancyQuantity)]),[
      [10,7,-3],[5,0,-5],[0,2,2],[4,4,0],
    ]);
    const result=await postInventoryCount(db,{organizationId:1,documentId:created.document.id,actorEmail:"counter@example.com"});
    assert.equal(result.ok,true);assert.equal(result.idempotent,false);
    assert.equal(stock(raw,1,a.warehouseId,a.lotId),7);
    assert.equal(stock(raw,1,b.warehouseId,b.lotId),0);
    assert.equal(stock(raw,1,c.warehouseId,c.lotId),2);
    assert.equal(stock(raw,1,d.warehouseId,d.lotId),4);
    const adjustments=raw.prepare(`SELECT document_line_id AS lineId,quantity_delta AS delta,actor_email AS actor
      FROM inventory_movements WHERE organization_id=1 AND document_id=? AND movement_type='count_adjustment' ORDER BY document_line_id`).all(created.document.id);
    assert.equal(adjustments.length,3,"zero discrepancy must not pollute the physical ledger");
    assert.deepEqual(adjustments.map(x=>Number(x.delta)),[-3,-5,2]);
    assert.ok(adjustments.every(x=>x.actor==="counter@example.com"));
    assert.equal(Number(raw.prepare(`SELECT COUNT(*) AS n FROM expense_movements
      WHERE organization_id=1 AND document_id=?`).get(created.document.id).n),0,"count gain/loss must not synthesize acquisition expense");
    const replay=await postInventoryCount(db,{organizationId:1,documentId:created.document.id,actorEmail:"counter@example.com"});
    assert.equal(replay.ok,true);assert.equal(replay.idempotent,true);
    assert.equal(Number(raw.prepare(`SELECT COUNT(*) AS n FROM inventory_movements
      WHERE organization_id=1 AND document_id=?`).get(created.document.id).n),3);
  }finally{close();}
});

test("inventory count rejects a stale book snapshot and leaves the document draft",async()=>{
  const {db,raw,close}=await freshDb();try{
    const seeded=await seedStock(db,raw,{quantity:10});
    const created=await createInventoryCount(db,{organizationId:1,actorEmail:"counter@example.com",lines:[
      {lotId:seeded.lotId,warehouseId:seeded.warehouseId,countedQuantity:8},
    ]});
    raw.prepare(`INSERT INTO inventory_movements
      (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email)
      VALUES (1,?,?,?,?,?,'receipt',1,'intervening receipt','test')`)
      .run(seeded.itemId,seeded.lotId,seeded.warehouseId,seeded.warehouseCode,seeded.warehouseName);
    const result=await postInventoryCount(db,{organizationId:1,documentId:created.document.id,actorEmail:"counter@example.com"});
    assert.equal(result.ok,false);assert.equal(result.status,409);assert.match(result.error,/Залишок змінився/);
    assert.equal((await getInventoryCount(db,1,created.document.id)).document.state,"draft");
    assert.equal(Number(raw.prepare(`SELECT COUNT(*) AS n FROM inventory_movements
      WHERE organization_id=1 AND document_id=?`).get(created.document.id).n),0);
    assert.equal(stock(raw,1,seeded.warehouseId,seeded.lotId),11);
  }finally{close();}
});

test("inventory count loss cannot reduce physical stock below active reservation floor",async()=>{
  const {db,raw,close}=await freshDb();try{
    const seeded=await seedStock(db,raw,{quantity:5});
    await seedReservation(db,raw,{itemId:seeded.itemId,warehouseId:seeded.warehouseId,quantity:2});
    const reserved=Number(raw.prepare(`SELECT COALESCE(SUM(quantity_delta),0) AS q FROM inventory_reservation_movements
      WHERE organization_id=1 AND warehouse_id=? AND item_id=?`).get(seeded.warehouseId,seeded.itemId).q);
    assert.equal(reserved,2);
    const created=await createInventoryCount(db,{organizationId:1,actorEmail:"counter@example.com",lines:[
      {lotId:seeded.lotId,warehouseId:seeded.warehouseId,countedQuantity:1},
    ]});
    const result=await postInventoryCount(db,{organizationId:1,documentId:created.document.id,actorEmail:"counter@example.com"});
    assert.equal(result.ok,false);assert.equal(result.status,409);assert.match(result.error,/активний резерв/);
    assert.equal((await getInventoryCount(db,1,created.document.id)).document.state,"draft");
    assert.equal(stock(raw,1,seeded.warehouseId,seeded.lotId),5);
  }finally{close();}
});

test("inventory count is tenant scoped and D1 rejects forged snapshots and orphan adjustments",async()=>{
  const {db,raw,close}=await freshDb();try{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Count Org 2','count-org-2',1)");
    const one=await seedStock(db,raw,{organizationId:1,quantity:3});
    const two=await seedStock(db,raw,{organizationId:2,quantity:4});
    await assert.rejects(()=>createInventoryCount(db,{organizationId:1,actorEmail:"counter@example.com",lines:[
      {lotId:two.lotId,warehouseId:one.warehouseId,countedQuantity:4},
    ]}),/inventory_count_lot_not_found/);
    const created=await createInventoryCount(db,{organizationId:1,actorEmail:"counter@example.com",lines:[
      {lotId:one.lotId,warehouseId:one.warehouseId,countedQuantity:3},
    ]});
    assert.equal(await getInventoryCount(db,2,created.document.id),null);
    assert.throws(()=>raw.prepare(`INSERT INTO inventory_count_lines
      (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,item_name,item_unit,lot_number,book_quantity,counted_quantity,reason)
      SELECT organization_id,document_id,99,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,item_name,item_unit,lot_number,999,counted_quantity,'forged'
      FROM inventory_count_lines WHERE organization_id=1 AND document_id=? LIMIT 1`).run(created.document.id),/inventory_count_book_mismatch/);
    assert.throws(()=>raw.prepare(`INSERT INTO inventory_movements
      (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email)
      VALUES (1,?,?,?,?,?,'count_adjustment',1,'forged','attacker')`)
      .run(one.itemId,one.lotId,one.warehouseId,one.warehouseCode,one.warehouseName),/inventory_count_registrar_required/);
    const lineId=created.lines[0].id;
    assert.throws(()=>raw.prepare("UPDATE inventory_count_lines SET counted_quantity=99 WHERE id=?").run(lineId),/inventory_count_line_immutable/);
  }finally{close();}
});
