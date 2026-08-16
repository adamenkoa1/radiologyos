import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function inventory(db,cookie,body){return callWorker(jsonRequest("/api/staff/inventory",body,{headers:{cookie}}),db);}
async function document(db,cookie,body){return callWorker(jsonRequest("/api/staff/inventory/documents",body,{headers:{cookie}}),db);}
async function warehouse(db,cookie,body){return callWorker(jsonRequest("/api/staff/warehouses",body,{headers:{cookie}}),db);}

async function setupStock(db,raw,cookie,quantity=10){
  const itemRes=await inventory(db,cookie,{action:"create_item",name:"Transfer contrast",sku:`TR-${Date.now()}-${Math.random()}`,category:"contrast",unit:"фл",minStock:0});
  assert.equal(itemRes.status,201);
  const {id:itemId}=await itemRes.json();
  const main=raw.prepare("SELECT id,code,name FROM warehouses WHERE organization_id=1 AND is_default=1").get();
  const receipt=await inventory(db,cookie,{action:"receive",itemId,warehouseId:main.id,quantity,lotNumber:"TR-LOT"});
  assert.equal(receipt.status,201);
  const {lotId}=await receipt.json();
  return {itemId,lotId,main};
}

test("posted transfer moves the same lot between warehouses and keeps organization total unchanged",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"transfer@example.com",role:"admin",organizationId:1});
    const {lotId,main}=await setupStock(db,raw,cookie,10);
    const destinationRes=await warehouse(db,cookie,{code:"CT-TR",name:"Склад КТ transfer",active:true});
    assert.equal(destinationRes.status,201);
    const {warehouse:destination}=await destinationRes.json();

    const draftRes=await document(db,cookie,{
      action:"create",documentType:"inventory_transfer",
      sourceWarehouseId:main.id,destinationWarehouseId:destination.id,
      lines:[{lotId,quantity:4,reason:"Переміщення до КТ"}],
    });
    assert.equal(draftRes.status,201);
    const draft=await draftRes.json();
    assert.equal(draft.document.documentType,"inventory_transfer");
    assert.match(draft.document.number,/^ПМ-\d{6}$/);
    assert.equal(draft.transfer.sourceWarehouseId,main.id);
    assert.equal(draft.transfer.destinationWarehouseId,destination.id);
    assert.equal(draft.lines[0].warehouseId,main.id,"line snapshot is the source warehouse");

    const posted=await document(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(posted.status,200);
    const movements=raw.prepare(
      `SELECT movement_type,warehouse_id,quantity_delta,lot_id,warehouse_code,warehouse_name
       FROM inventory_movements WHERE organization_id=1 AND document_id=? ORDER BY id`
    ).all(draft.document.id);
    assert.equal(movements.length,2);
    assert.deepEqual(movements.map(row=>row.movement_type),["transfer_out","transfer_in"]);
    assert.equal(movements[0].warehouse_id,main.id);assert.equal(movements[0].quantity_delta,-4);
    assert.equal(movements[1].warehouse_id,destination.id);assert.equal(movements[1].quantity_delta,4);
    assert.equal(movements[0].lot_id,lotId);assert.equal(movements[1].lot_id,lotId);

    const sourceStock=raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE organization_id=1 AND warehouse_id=? AND lot_id=?").get(main.id,lotId).stock;
    const destinationStock=raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE organization_id=1 AND warehouse_id=? AND lot_id=?").get(destination.id,lotId).stock;
    const total=raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE organization_id=1 AND lot_id=?").get(lotId).stock;
    assert.equal(sourceStock,6);assert.equal(destinationStock,4);assert.equal(total,10);

    const replay=await document(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(replay.status,200);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE document_id=?").get(draft.document.id).n,2);
  });
});

test("insufficient source stock aborts both transfer directions and leaves document draft",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"transfer-negative@example.com",role:"admin",organizationId:1});
    const {lotId,main}=await setupStock(db,raw,cookie,2);
    const destinationRes=await warehouse(db,cookie,{code:"XR-NEG",name:"Склад XR negative",active:true});
    const {warehouse:destination}=await destinationRes.json();
    const draftRes=await document(db,cookie,{
      action:"create",documentType:"inventory_transfer",sourceWarehouseId:main.id,destinationWarehouseId:destination.id,
      lines:[{lotId,quantity:3}],
    });
    const draft=await draftRes.json();

    const post=await document(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(post.status,409);
    assert.match((await post.json()).error,/Недостатній залишок/);
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(draft.document.id).state,"draft");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE document_id=?").get(draft.document.id).n,0);

    assert.throws(()=>raw.prepare(
      "UPDATE business_documents SET state='posted',posted_by='forged',posted_at='2026-08-16T20:00:00Z' WHERE id=?"
    ).run(draft.document.id),/inventory_negative_stock/);
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(draft.document.id).state,"draft");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE document_id=?").get(draft.document.id).n,0);
  });
});

test("transfer rejects same-warehouse and foreign-tenant destinations",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Transfer Org 2','transfer-org-2',1)");
    const cookie=await seedStaffSession(db,{email:"transfer-tenant@example.com",role:"admin",organizationId:1});
    const {lotId,main}=await setupStock(db,raw,cookie,5);
    const foreign=raw.prepare("SELECT id FROM warehouses WHERE organization_id=2 AND is_default=1").get();

    const same=await document(db,cookie,{
      action:"create",documentType:"inventory_transfer",sourceWarehouseId:main.id,destinationWarehouseId:main.id,
      lines:[{lotId,quantity:1}],
    });
    assert.equal(same.status,400);

    const crossTenant=await document(db,cookie,{
      action:"create",documentType:"inventory_transfer",sourceWarehouseId:main.id,destinationWarehouseId:foreign.id,
      lines:[{lotId,quantity:1}],
    });
    assert.equal(crossTenant.status,404);
  });
});

test("posted transfer keeps frozen source and destination snapshots after master-data rename",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"transfer-snapshot@example.com",role:"admin",organizationId:1});
    const {lotId,main}=await setupStock(db,raw,cookie,5);
    const destinationRes=await warehouse(db,cookie,{code:"DST",name:"Склад призначення",active:true});
    const {warehouse:destination}=await destinationRes.json();
    const draftRes=await document(db,cookie,{
      action:"create",documentType:"inventory_transfer",sourceWarehouseId:main.id,destinationWarehouseId:destination.id,
      lines:[{lotId,quantity:2}],
    });
    const draft=await draftRes.json();
    assert.equal((await document(db,cookie,{action:"post",documentId:draft.document.id})).status,200);

    raw.prepare("UPDATE warehouses SET code='MAIN-NEW',name='Головний склад новий' WHERE id=?").run(main.id);
    raw.prepare("UPDATE warehouses SET code='DST-NEW',name='Склад призначення новий' WHERE id=?").run(destination.id);

    const details=raw.prepare(
      `SELECT source_warehouse_code,source_warehouse_name,destination_warehouse_code,destination_warehouse_name
       FROM inventory_transfer_details WHERE document_id=?`
    ).get(draft.document.id);
    assert.deepEqual({...details},{
      source_warehouse_code:main.code,source_warehouse_name:main.name,
      destination_warehouse_code:"DST",destination_warehouse_name:"Склад призначення",
    });
    const movements=raw.prepare("SELECT movement_type,warehouse_code,warehouse_name FROM inventory_movements WHERE document_id=? ORDER BY id").all(draft.document.id);
    assert.equal(movements[0].warehouse_code,main.code);assert.equal(movements[0].warehouse_name,main.name);
    assert.equal(movements[1].warehouse_code,"DST");assert.equal(movements[1].warehouse_name,"Склад призначення");
  });
});
