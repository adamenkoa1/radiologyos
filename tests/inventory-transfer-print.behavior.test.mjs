import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function inventory(db,cookie,body){return callWorker(jsonRequest("/api/staff/inventory",body,{headers:{cookie}}),db);}
async function document(db,cookie,body){return callWorker(jsonRequest("/api/staff/inventory/documents",body,{headers:{cookie}}),db);}
async function warehouse(db,cookie,body){return callWorker(jsonRequest("/api/staff/warehouses",body,{headers:{cookie}}),db);}
async function printDocument(db,cookie,documentId){return callWorker(jsonRequest("/api/staff/inventory/documents/print",{documentId},{headers:{cookie}}),db);}

test("posted transfer print freezes both warehouse snapshots and reprints the canonical evidence",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"transfer-print@example.com",role:"admin",organizationId:1});
    const source=raw.prepare("SELECT id,code,name FROM warehouses WHERE organization_id=1 AND is_default=1").get();
    const destinationRes=await warehouse(db,cookie,{code:"PRINT-DST",name:"Склад друку transfer",active:true});
    const {warehouse:destination}=await destinationRes.json();
    const itemRes=await inventory(db,cookie,{action:"create_item",name:"Print transfer item",sku:"PRINT-TR",category:"other",unit:"шт",minStock:0});
    const {id:itemId}=await itemRes.json();
    const receipt=await inventory(db,cookie,{action:"receive",itemId,warehouseId:source.id,quantity:3,lotNumber:"PRINT-LOT"});
    const {lotId}=await receipt.json();
    const draftRes=await document(db,cookie,{
      action:"create",documentType:"inventory_transfer",sourceWarehouseId:source.id,destinationWarehouseId:destination.id,
      lines:[{lotId,quantity:1,reason:"Для друку"}],
    });
    const draft=await draftRes.json();
    assert.equal((await document(db,cookie,{action:"post",documentId:draft.document.id})).status,200);

    const first=await printDocument(db,cookie,draft.document.id);
    assert.equal(first.status,201);
    const firstBody=await first.json();
    assert.equal(firstBody.snapshot.formType,"inventory_transfer");
    assert.equal(firstBody.payload.transfer.sourceWarehouseName,source.name);
    assert.equal(firstBody.payload.transfer.destinationWarehouseName,"Склад друку transfer");
    assert.equal(firstBody.payload.lines[0].lotNumber,"PRINT-LOT");

    raw.prepare("UPDATE warehouses SET name='Source renamed',code='SRC-NEW' WHERE id=?").run(source.id);
    raw.prepare("UPDATE warehouses SET name='Destination renamed',code='DST-NEW' WHERE id=?").run(destination.id);

    const again=await printDocument(db,cookie,draft.document.id);
    assert.equal(again.status,200);
    const secondBody=await again.json();
    assert.equal(secondBody.snapshot.id,firstBody.snapshot.id);
    assert.equal(secondBody.snapshot.sha256,firstBody.snapshot.sha256);
    assert.equal(secondBody.payload.transfer.sourceWarehouseName,source.name);
    assert.equal(secondBody.payload.transfer.destinationWarehouseName,"Склад друку transfer");

    assert.throws(()=>raw.prepare("UPDATE printed_form_snapshots SET generated_by='tamper' WHERE id=?").run(firstBody.snapshot.id),/printed_form_snapshot_immutable/);
  });
});