import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function post(db,cookie,url,body){return callWorker(jsonRequest(url,body,{headers:{cookie}}),db);}
async function warehouse(db,cookie,body){return post(db,cookie,"/api/staff/warehouses",body);}
async function inventory(db,cookie,body){return post(db,cookie,"/api/staff/inventory",body);}
async function document(db,cookie,body){return post(db,cookie,"/api/staff/inventory/documents",body);}
async function transfer(db,cookie,body){return post(db,cookie,"/api/staff/inventory/transfers",body);}

async function seedStock(db,raw,cookie,quantity=5){
  const itemRes=await inventory(db,cookie,{action:"create_item",name:"Transfer contrast",sku:"TR-CON",category:"contrast",unit:"фл",minStock:0});
  assert.equal(itemRes.status,201);const {id:itemId}=await itemRes.json();
  const receipt=await inventory(db,cookie,{action:"receive",itemId,quantity,lotNumber:"TR-LOT"});
  assert.equal(receipt.status,201);const body=await receipt.json();
  const lotId=body.lotId;
  const main=raw.prepare("SELECT id,code,name FROM warehouses WHERE organization_id=1 AND is_default=1").get();
  return{itemId,lotId,main};
}

test("posted transfer moves the same lot atomically between warehouse buckets",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"transfer@example.com",role:"admin",organizationId:1});
    const {lotId,main}=await seedStock(db,raw,cookie,5);
    const destinationRes=await warehouse(db,cookie,{code:"CT",name:"Склад КТ",active:true});
    assert.equal(destinationRes.status,201);const {warehouse:destination}=await destinationRes.json();

    const created=await transfer(db,cookie,{action:"create",comment:"До КТ",lines:[{
      lotId,sourceWarehouseId:main.id,destinationWarehouseId:destination.id,quantity:3,reason:"Поповнення КТ",
    }]});
    assert.equal(created.status,201);const draft=await created.json();
    assert.equal(draft.document.documentType,"inventory_transfer");
    assert.equal(draft.document.state,"draft");
    assert.equal(draft.lines[0].sourceWarehouseCode,"MAIN");
    assert.equal(draft.lines[0].destinationWarehouseCode,"CT");

    const posted=await transfer(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(posted.status,200);const postedBody=await posted.json();
    assert.equal(postedBody.document.state,"posted");

    const movements=raw.prepare(
      "SELECT movement_type,warehouse_id,quantity_delta,document_line_id FROM inventory_movements WHERE organization_id=1 AND document_id=? ORDER BY id"
    ).all(draft.document.id);
    assert.equal(movements.length,2);
    assert.deepEqual(movements.map(row=>row.movement_type),["transfer_out","transfer_in"]);
    assert.equal(movements[0].warehouse_id,main.id);assert.equal(movements[0].quantity_delta,-3);
    assert.equal(movements[1].warehouse_id,destination.id);assert.equal(movements[1].quantity_delta,3);
    assert.equal(movements[0].document_line_id,movements[1].document_line_id);

    const sourceStock=raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE organization_id=1 AND warehouse_id=? AND lot_id=?").get(main.id,lotId).stock;
    const destinationStock=raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE organization_id=1 AND warehouse_id=? AND lot_id=?").get(destination.id,lotId).stock;
    assert.equal(sourceStock,2);assert.equal(destinationStock,3);

    const replay=await transfer(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(replay.status,200);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE document_id=?").get(draft.document.id).count,2);
  });
});

test("transfer cannot borrow stock from another warehouse or use the same warehouse",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"transfer-guard@example.com",role:"admin",organizationId:1});
    const {lotId,main}=await seedStock(db,raw,cookie,2);
    const destinationRes=await warehouse(db,cookie,{code:"XR",name:"Рентген-склад",active:true});
    const {warehouse:destination}=await destinationRes.json();

    const same=await transfer(db,cookie,{action:"create",lines:[{lotId,sourceWarehouseId:main.id,destinationWarehouseId:main.id,quantity:1}]});
    assert.equal(same.status,400);assert.match((await same.json()).error,/відрізнятися/i);

    const first=await transfer(db,cookie,{action:"create",lines:[{lotId,sourceWarehouseId:main.id,destinationWarehouseId:destination.id,quantity:2}]});
    const firstBody=await first.json();assert.equal((await transfer(db,cookie,{action:"post",documentId:firstBody.document.id})).status,200);

    // All stock is now in XR. A new transfer that still names MAIN as source must fail even though
    // the tenant owns two units of the same lot in another warehouse.
    const wrongSource=await transfer(db,cookie,{action:"create",lines:[{lotId,sourceWarehouseId:main.id,destinationWarehouseId:destination.id,quantity:1}]});
    const wrongBody=await wrongSource.json();const denied=await transfer(db,cookie,{action:"post",documentId:wrongBody.document.id});
    assert.equal(denied.status,409);assert.match((await denied.json()).error,/складі-відправнику/i);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE document_id=?").get(wrongBody.document.id).count,0);
  });
});

test("transfer enforces tenant ownership and exact destination snapshot in D1",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Other Org','other-org',1)");
    const cookie=await seedStaffSession(db,{email:"transfer-tenant@example.com",role:"admin",organizationId:1});
    const {itemId,lotId,main}=await seedStock(db,raw,cookie,2);
    const foreign=raw.prepare("SELECT id FROM warehouses WHERE organization_id=2 AND is_default=1").get();
    const denied=await transfer(db,cookie,{action:"create",lines:[{lotId,sourceWarehouseId:main.id,destinationWarehouseId:foreign.id,quantity:1}]});
    assert.equal(denied.status,404);

    const destinationRes=await warehouse(db,cookie,{code:"SAFE",name:"Безпечний склад",active:true});
    const {warehouse:destination}=await destinationRes.json();

    // New transfer movement types cannot exist outside an exact BAS document registrar.
    assert.throws(()=>raw.prepare(
      `INSERT INTO inventory_movements
       (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email)
       VALUES (1,?,?,?,?,?,'transfer_in',1,'unregistered','tamper')`
    ).run(itemId,lotId,destination.id,destination.code,destination.name),/inventory_transfer_registrar_required/);

    const created=await transfer(db,cookie,{action:"create",lines:[{lotId,sourceWarehouseId:main.id,destinationWarehouseId:destination.id,quantity:1}]});
    const body=await created.json();const line=body.lines[0];

    // Destination is already part of an immutable business fact while the document is a draft.
    assert.throws(()=>raw.prepare(
      "DELETE FROM warehouses WHERE organization_id=1 AND id=?"
    ).run(destination.id),/warehouse_in_use/);
    assert.throws(()=>raw.prepare(
      "UPDATE inventory_document_lines SET destination_warehouse_code='TAMPER' WHERE id=?"
    ).run(line.id),/inventory_transfer_destination_invalid/);

    // Receipt/writeoff lines may never acquire a destination dimension and masquerade as transfers.
    const receiptDraftRes=await document(db,cookie,{action:"create",documentType:"inventory_receipt",lines:[{
      itemId,warehouseId:main.id,quantity:1,lotNumber:"NO-DEST",
    }]});
    assert.equal(receiptDraftRes.status,201);const receiptDraft=await receiptDraftRes.json();
    assert.throws(()=>raw.prepare(
      `UPDATE inventory_document_lines
       SET destination_warehouse_id=?,destination_warehouse_code=?,destination_warehouse_name=?
       WHERE id=?`
    ).run(destination.id,destination.code,destination.name,receiptDraft.lines[0].id),/inventory_destination_not_allowed/);

    assert.equal((await transfer(db,cookie,{action:"post",documentId:body.document.id})).status,200);
    const out=raw.prepare("SELECT * FROM inventory_movements WHERE document_id=? AND movement_type='transfer_out'").get(body.document.id);
    assert.throws(()=>raw.prepare(
      `INSERT INTO inventory_movements
       (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email,document_id,document_line_id)
       VALUES (1,?,?,?,?,?,'transfer_in',1,?,?,?,?)`
    ).run(out.item_id,out.lot_id,main.id,main.code,main.name,line.reason,"tamper",body.document.id,line.id),/inventory_document_link_invalid/);
  });
});
