import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function warehouses(db,cookie){return callWorker(new Request("http://localhost/api/staff/warehouses",{headers:{cookie}}),db);}
async function saveWarehouse(db,cookie,body,method="POST"){
  return callWorker(jsonRequest("/api/staff/warehouses",body,{method,headers:{cookie}}),db);
}
async function inventory(db,cookie,body){return callWorker(jsonRequest("/api/staff/inventory",body,{headers:{cookie}}),db);}
async function document(db,cookie,body){return callWorker(jsonRequest("/api/staff/inventory/documents",body,{headers:{cookie}}),db);}

test("every organization has exactly one active default warehouse",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"warehouse-default@example.com",role:"admin",organizationId:1});
    const response=await warehouses(db,cookie);assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.warehouses.filter(w=>w.isDefault).length,1);
    assert.equal(payload.warehouses.find(w=>w.isDefault).code,"MAIN");

    raw.exec("INSERT INTO organizations (id,name,slug,active) VALUES (22,'Warehouse Org','warehouse-org',1)");
    const row=raw.prepare("SELECT code,name,active,is_default FROM warehouses WHERE organization_id=22").get();
    assert.equal(row.code,"MAIN");assert.equal(row.name,"Основний склад");assert.equal(row.active,1);assert.equal(row.is_default,1);
  });
});

test("writeoff cannot consume another warehouse balance for the same lot",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"warehouse-split@example.com",role:"admin",organizationId:1});
    const createdWarehouse=await saveWarehouse(db,cookie,{code:"CT",name:"Склад КТ",active:true});
    assert.equal(createdWarehouse.status,201);const {warehouse:ct}=await createdWarehouse.json();
    const main=raw.prepare("SELECT id FROM warehouses WHERE organization_id=1 AND is_default=1").get();

    const itemRes=await inventory(db,cookie,{action:"create_item",name:"Контраст складський",sku:"WH-CT",category:"contrast",unit:"фл",minStock:0});
    const {id:itemId}=await itemRes.json();
    const receipt=await document(db,cookie,{action:"create",documentType:"inventory_receipt",lines:[{itemId,warehouseId:ct.id,quantity:5,lotNumber:"WH-SAME"}]});
    assert.equal(receipt.status,201);const receiptBody=await receipt.json();
    assert.equal((await document(db,cookie,{action:"post",documentId:receiptBody.document.id})).status,200);
    const lotId=raw.prepare("SELECT lot_id AS lotId FROM inventory_document_lines WHERE document_id=?").get(receiptBody.document.id).lotId;

    const wrong=await document(db,cookie,{action:"create",documentType:"inventory_writeoff",lines:[{lotId,warehouseId:main.id,quantity:1,reason:"Не той склад"}]});
    assert.equal(wrong.status,201);const wrongBody=await wrong.json();
    const wrongPost=await document(db,cookie,{action:"post",documentId:wrongBody.document.id});
    assert.equal(wrongPost.status,409);
    assert.match((await wrongPost.json()).error,/вибраному складі/i);

    const right=await document(db,cookie,{action:"create",documentType:"inventory_writeoff",lines:[{lotId,warehouseId:ct.id,quantity:2,reason:"Використано"}]});
    const rightBody=await right.json();assert.equal((await document(db,cookie,{action:"post",documentId:rightBody.document.id})).status,200);
    const ctStock=raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE organization_id=1 AND warehouse_id=? AND lot_id=?").get(ct.id,lotId).stock;
    const mainStock=raw.prepare("SELECT COALESCE(SUM(quantity_delta),0) AS stock FROM inventory_movements WHERE organization_id=1 AND warehouse_id=? AND lot_id=?").get(main.id,lotId).stock;
    assert.equal(ctStock,3);assert.equal(mainStock,0);
  });
});

test("warehouse tenant and frozen snapshot are enforced",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Org 2','org-2',1)");
    const org1=await seedStaffSession(db,{email:"warehouse-org1@example.com",role:"admin",organizationId:1});
    const foreign=raw.prepare("SELECT id FROM warehouses WHERE organization_id=2 AND is_default=1").get();
    const itemRes=await inventory(db,org1,{action:"create_item",name:"Папір WH",sku:"WH-P",category:"paper",unit:"пач",minStock:0});
    const {id:itemId}=await itemRes.json();
    const denied=await document(db,org1,{action:"create",documentType:"inventory_receipt",lines:[{itemId,warehouseId:foreign.id,quantity:1,lotNumber:"FOREIGN"}]});
    assert.equal(denied.status,404);

    const secondRes=await saveWarehouse(db,org1,{code:"XR",name:"Рентген-склад",active:true});const {warehouse:second}=await secondRes.json();
    const receipt=await document(db,org1,{action:"create",documentType:"inventory_receipt",lines:[{itemId,warehouseId:second.id,quantity:2,lotNumber:"SNAP"}]});
    const body=await receipt.json();
    assert.throws(()=>raw.prepare("UPDATE inventory_document_lines SET warehouse_id=?,warehouse_code='MAIN',warehouse_name='Основний склад' WHERE id=?").run(foreign.id,body.lines[0].id),/inventory_warehouse_tenant_mismatch/);
    assert.equal((await document(db,org1,{action:"post",documentId:body.document.id})).status,200);
    const line=raw.prepare("SELECT warehouse_id,warehouse_code,warehouse_name FROM inventory_document_lines WHERE document_id=?").get(body.document.id);
    const movement=raw.prepare("SELECT warehouse_id,warehouse_code,warehouse_name FROM inventory_movements WHERE document_id=?").get(body.document.id);
    assert.deepEqual(line,{warehouse_id:second.id,warehouse_code:"XR",warehouse_name:"Рентген-склад"});
    assert.deepEqual(movement,{warehouse_id:second.id,warehouse_code:"XR",warehouse_name:"Рентген-склад"});

    const renamed=await saveWarehouse(db,org1,{id:second.id,name:"Склад рентгенографії",code:"XR2",active:true,isDefault:false},"PATCH");
    assert.equal(renamed.status,200);
    const after=raw.prepare("SELECT warehouse_code,warehouse_name FROM inventory_movements WHERE document_id=?").get(body.document.id);
    assert.deepEqual(after,{warehouse_code:"XR",warehouse_name:"Рентген-склад"},"posted register snapshot must not follow master-data rename");
  });
});
