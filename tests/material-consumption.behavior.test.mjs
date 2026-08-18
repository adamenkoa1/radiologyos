import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function api(db,url,cookie,body,method="POST"){
  return callWorker(jsonRequest(url,body,{method,headers:{cookie}}),db);
}
async function get(db,url,cookie){return callWorker(new Request(`http://localhost${url}`,{headers:{cookie}}),db);}
async function inventory(db,cookie,body){return api(db,"/api/staff/inventory/documents",cookie,body);}
async function payables(db,cookie,body){return api(db,"/api/staff/supplier-payables",cookie,body);}

async function valuedStock(db,raw,cookie,{sku="CONS-MAT",quantity=3,unitCost=10}={}){
  const itemResult=await db.prepare(`INSERT INTO inventory_items
    (organization_id,sku,name,category,unit,min_stock,active) VALUES (1,?,'Consumption material','other','мл',0,1)`).bind(sku).run();
  const itemId=Number(itemResult.meta.last_row_id);
  const supplierResult=await db.prepare(`INSERT INTO counterparties (organization_id,code,name,kind,active)
    VALUES (1,?,'Consumption Supplier','supplier',1)`).bind(`${sku}-SUP`).run();
  const supplierId=Number(supplierResult.meta.last_row_id);
  const createdResponse=await inventory(db,cookie,{action:"create",documentType:"inventory_receipt",occurredAt:"2026-12-01T08:00:00",lines:[{itemId,quantity,lotNumber:`${sku}-LOT`,supplierCounterpartyId:supplierId,reason:"Закупівля"}]});
  assert.equal(createdResponse.status,201);const created=await createdResponse.json();const line=created.lines[0];
  assert.equal((await payables(db,cookie,{action:"value_receipt",documentId:created.document.id,lines:[{lineId:line.id,unitCost}]})).status,200);
  assert.equal((await inventory(db,cookie,{action:"post",documentId:created.document.id})).status,200);
  const stored=raw.prepare(`SELECT lot_id AS lotId,warehouse_id AS warehouseId FROM inventory_document_lines WHERE id=?`).get(line.id);
  return {itemId,lotId:Number(stored.lotId),warehouseId:Number(stored.warehouseId)};
}

let seq=0;
async function completedReservation(db,raw,{itemId,warehouseId,quantity=3,serviceCode="ct-consumption"}){
  await db.prepare(`INSERT INTO service_material_requirements
    (organization_id,service_code,item_id,warehouse_id,quantity,active,created_by,updated_by)
    VALUES (1,?,?,?,?,1,'materials-admin@example.com','materials-admin@example.com')`)
    .bind(serviceCode,itemId,warehouseId,quantity).run();
  seq+=1;const patientId=`PAT-CONS-${seq}`,phone=`38067${String(8000000+seq).padStart(7,"0")}`;
  await db.prepare(`INSERT INTO patient_profiles (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES (?,1,?,'Consumption Patient','test')`).bind(patientId,phone).run();
  const bookingResult=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (1,?,'Consumption Patient',?,?,?,'1980-01-02','КТ витрата',?,'ct',30,'2026-12-01','10:00',
      'civilian','pending',2500,0,'confirmed',1,'cons-doctor@example.com','cons-tech@example.com')`)
    .bind(`CONS-${seq}`,`+${phone}`,phone,patientId,serviceCode).run();
  const bookingId=Number(bookingResult.meta.last_row_id);
  await db.prepare(`UPDATE bookings SET status='completed',performed_at='2026-12-01T10:05:00'
    WHERE organization_id=1 AND id=?`).bind(bookingId).run();
  const reserve=raw.prepare(`SELECT r.id,r.quantity_delta AS quantityDelta FROM inventory_reservation_movements r
    WHERE r.organization_id=1 AND r.booking_id=? AND r.movement_type='reserve' LIMIT 1`).get(bookingId);
  assert.ok(reserve?.id);assert.equal(Number(reserve.quantityDelta),quantity);
  assert.equal(Number(raw.prepare(`SELECT COUNT(*) AS n FROM inventory_reservation_movements
    WHERE organization_id=1 AND booking_id=? AND movement_type='release'`).get(bookingId).n),1);
  return {bookingId,reservationId:Number(reserve.id)};
}

test("completed reservation becomes explicit lot-linked writeoff drafts and existing posting creates stock expense",async()=>{
  await withD1(async(db,raw)=>{
    const admin=await seedStaffSession(db,{email:"cons-admin@example.com",role:"admin",organizationId:1});
    const tech=await seedStaffSession(db,{email:"cons-tech@example.com",role:"radiographer",organizationId:1});
    const stock=await valuedStock(db,raw,admin,{quantity:3,unitCost:10});
    const source=await completedReservation(db,raw,{itemId:stock.itemId,warehouseId:stock.warehouseId,quantity:3});

    const initial=await get(db,"/api/staff/material-consumption",tech);assert.equal(initial.status,200);
    let body=await initial.json();const row=body.rows.find(x=>x.reservationId===source.reservationId);assert.ok(row);
    assert.equal(row.plannedQuantity,3);assert.equal(row.draftQuantity,0);assert.equal(row.postedQuantity,0);assert.equal(row.remainingQuantity,3);assert.equal(row.status,"open");

    const firstResponse=await api(db,"/api/staff/material-consumption",tech,{reservationId:source.reservationId,allocations:[{lotId:stock.lotId,quantity:2}]});
    assert.equal(firstResponse.status,201);const first=await firstResponse.json();
    assert.equal(first.document.documentType,"inventory_writeoff");assert.equal(first.document.state,"draft");
    assert.equal(first.lines.length,1);assert.equal(first.lines[0].reservationMovementId,source.reservationId);assert.equal(first.lines[0].bookingId,source.bookingId);

    const over=await api(db,"/api/staff/material-consumption",tech,{reservationId:source.reservationId,allocations:[{lotId:stock.lotId,quantity:2}]});
    assert.equal(over.status,409);
    const secondResponse=await api(db,"/api/staff/material-consumption",tech,{reservationId:source.reservationId,allocations:[{lotId:stock.lotId,quantity:1}]});
    assert.equal(secondResponse.status,201);const second=await secondResponse.json();

    assert.equal((await inventory(db,tech,{action:"post",documentId:first.document.id})).status,200);
    assert.equal((await inventory(db,tech,{action:"post",documentId:second.document.id})).status,200);
    const finalResponse=await get(db,"/api/staff/material-consumption",tech);body=await finalResponse.json();
    const final=body.rows.find(x=>x.reservationId===source.reservationId);assert.ok(final);
    assert.equal(final.draftQuantity,0);assert.equal(final.postedQuantity,3);assert.equal(final.remainingQuantity,0);assert.equal(final.status,"consumed");

    const linkedMovements=raw.prepare(`SELECT COUNT(*) AS n FROM inventory_movements m JOIN inventory_document_lines l
      ON l.id=m.document_line_id AND l.organization_id=m.organization_id
      WHERE m.organization_id=1 AND l.reservation_movement_id=? AND m.movement_type='writeoff'`).get(source.reservationId);
    assert.equal(Number(linkedMovements.n),2);
    const expense=raw.prepare(`SELECT COALESCE(SUM(e.amount_delta),0) AS amount,COUNT(*) AS n FROM expense_movements e
      JOIN inventory_document_lines l ON l.id=e.document_line_id AND l.organization_id=e.organization_id
      WHERE e.organization_id=1 AND l.reservation_movement_id=?`).get(source.reservationId);
    assert.equal(Number(expense.n),2);assert.equal(Number(expense.amount),30);

    const audits=raw.prepare(`SELECT action,details_json AS detailsJson FROM security_audit_log
      WHERE organization_id=1 AND action IN ('material_consumption_queue_viewed','material_consumption_draft_created') ORDER BY id`).all();
    assert.ok(audits.length>=3);
    for(const audit of audits){assert.equal(audit.detailsJson.includes("patient"),false);assert.equal(audit.detailsJson.includes("booking"),false);}
  });
});

test("cancelled consumption draft frees allocation and D1 blocks forged or excessive reservation links",async()=>{
  await withD1(async(db,raw)=>{
    const admin=await seedStaffSession(db,{email:"cons-guard@example.com",role:"admin",organizationId:1});
    const stock=await valuedStock(db,raw,admin,{sku:"CONS-GUARD",quantity:4,unitCost:5});
    const source=await completedReservation(db,raw,{itemId:stock.itemId,warehouseId:stock.warehouseId,quantity:2,serviceCode:"ct-cons-guard"});
    const draftResponse=await api(db,"/api/staff/material-consumption",admin,{reservationId:source.reservationId,allocations:[{lotId:stock.lotId,quantity:2}]});
    assert.equal(draftResponse.status,201);const draft=await draftResponse.json();
    assert.equal((await inventory(db,admin,{action:"cancel",documentId:draft.document.id})).status,200);
    const reopened=await get(db,"/api/staff/material-consumption",admin);const reopenedBody=await reopened.json();
    const row=reopenedBody.rows.find(x=>x.reservationId===source.reservationId);assert.equal(row.remainingQuantity,2);assert.equal(row.status,"open");

    const activeResponse=await api(db,"/api/staff/material-consumption",admin,{reservationId:source.reservationId,allocations:[{lotId:stock.lotId,quantity:1.5}]});
    assert.equal(activeResponse.status,201);const active=await activeResponse.json();const linkedLine=active.lines[0];
    assert.throws(()=>raw.prepare("UPDATE inventory_document_lines SET reservation_movement_id=NULL WHERE id=?").run(linkedLine.id),/inventory_consumption_reservation_link_immutable/);

    const fakeDoc=raw.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by)
      VALUES (1,'inventory_writeoff','CONS-FORGE','2026-12-01T11:00:00','draft','forge','test')`).run();
    const fakeDocId=Number(fakeDoc.lastInsertRowid);const warehouse=raw.prepare("SELECT code,name FROM warehouses WHERE id=?").get(stock.warehouseId);
    assert.throws(()=>raw.prepare(`INSERT INTO inventory_document_lines
      (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,lot_number,expires_on,supplier,quantity,reason,booking_id,reservation_movement_id)
      VALUES (1,?,1,?,?,?,?,?,'','','',1,'forge',?,?)`)
      .run(fakeDocId,stock.itemId,stock.lotId,stock.warehouseId,warehouse.code,warehouse.name,source.bookingId,source.reservationId),/inventory_consumption_overallocated/);

    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Consumption Org 2','consumption-org-2',1)");
    const org2Item=raw.prepare(`INSERT INTO inventory_items (organization_id,sku,name,category,unit,min_stock,active)
      VALUES (2,'CONS-O2','Other tenant','other','шт',0,1)`).run();
    const org2Warehouse=raw.prepare("SELECT id,code,name FROM warehouses WHERE organization_id=2 AND is_default=1 LIMIT 1").get();
    const org2Lot=raw.prepare(`INSERT INTO inventory_lots (organization_id,item_id,lot_number,expires_on,supplier) VALUES (2,?,'O2','','')`).run(Number(org2Item.lastInsertRowid));
    const crossDoc=raw.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by)
      VALUES (2,'inventory_writeoff','CONS-O2','2026-12-01T11:30:00','draft','forge','test')`).run();
    assert.throws(()=>raw.prepare(`INSERT INTO inventory_document_lines
      (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,lot_number,expires_on,supplier,quantity,reason,booking_id,reservation_movement_id)
      VALUES (2,?,1,?,?,?,?,?,'O2','','',0.1,'forge',?,?)`)
      .run(Number(crossDoc.lastInsertRowid),Number(org2Item.lastInsertRowid),Number(org2Lot.lastInsertRowid),org2Warehouse.id,org2Warehouse.code,org2Warehouse.name,source.bookingId,source.reservationId),/inventory_consumption_reservation_invalid/);
  });
});

test("material consumption worklist is restricted to inventory managers and tenant scoped",async()=>{
  await withD1(async(db,raw)=>{
    const admin=await seedStaffSession(db,{email:"cons-rbac-admin@example.com",role:"admin",organizationId:1});
    const doctor=await seedStaffSession(db,{email:"cons-rbac-doctor@example.com",role:"radiologist",organizationId:1});
    const stock=await valuedStock(db,raw,admin,{sku:"CONS-RBAC",quantity:2,unitCost:1});
    const source=await completedReservation(db,raw,{itemId:stock.itemId,warehouseId:stock.warehouseId,quantity:1,serviceCode:"ct-cons-rbac"});
    assert.equal((await get(db,"/api/staff/material-consumption",doctor)).status,403);

    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Consumption Tenant 2','consumption-tenant-2',1)");
    const admin2=await seedStaffSession(db,{email:"cons-rbac-org2@example.com",role:"admin",organizationId:2});
    const list2=await get(db,"/api/staff/material-consumption",admin2);assert.equal(list2.status,200);assert.equal((await list2.json()).rows.length,0);
    const cross=await api(db,"/api/staff/material-consumption",admin2,{reservationId:source.reservationId,allocations:[{lotId:stock.lotId,quantity:1}]});
    assert.equal(cross.status,404);
  });
});
