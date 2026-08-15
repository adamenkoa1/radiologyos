import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function postInventory(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory",body,{headers:{cookie}}),db);
}
async function printDocument(db,cookie,documentId) {
  return callWorker(jsonRequest("/api/staff/inventory/documents/print",{documentId},{headers:{cookie}}),db);
}

test("posted inventory form is snapshotted and exact reprint survives master-data edits", async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"printer@example.com",role:"admin",organizationId:1});
    const itemRes=await postInventory(db,cookie,{action:"create_item",name:"Контраст оригінальний",sku:"PRINT-1",category:"contrast",unit:"фл",minStock:1});
    const {id:itemId}=await itemRes.json();
    const receipt=await postInventory(db,cookie,{action:"receive",itemId,quantity:2,lotNumber:"P-01",supplier:"Постачальник"});
    const {documentId}=await receipt.json();

    const first=await printDocument(db,cookie,documentId);
    assert.equal(first.status,201);
    const form1=await first.json();
    assert.equal(form1.snapshot.templateVersion,1);
    assert.equal(form1.snapshot.documentState,"posted");
    assert.equal(form1.snapshot.sha256.length,64);
    assert.equal(form1.payload.lines[0].itemName,"Контраст оригінальний");

    await db.prepare("UPDATE inventory_items SET name='Контраст перейменований' WHERE organization_id=1 AND id=?").bind(itemId).run();

    const again=await printDocument(db,cookie,documentId);
    assert.equal(again.status,200);
    const form2=await again.json();
    assert.equal(form2.snapshot.id,form1.snapshot.id,"posted reprint must reuse canonical snapshot");
    assert.equal(form2.snapshot.sha256,form1.snapshot.sha256);
    assert.equal(form2.payload.lines[0].itemName,"Контраст оригінальний","historical print must not silently use renamed master data");

    assert.throws(()=>raw.prepare("UPDATE printed_form_snapshots SET generated_by='tamper@example.com' WHERE id=?").run(form1.snapshot.id),/printed_form_snapshot_immutable/);
    assert.throws(()=>raw.prepare("DELETE FROM printed_form_snapshots WHERE id=?").run(form1.snapshot.id),/printed_form_snapshot_immutable/);
  });
});

test("printed form snapshots are tenant scoped",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Org 2','org-2',1)");
    const org1=await seedStaffSession(db,{email:"print1@example.com",role:"admin",organizationId:1});
    const org2=await seedStaffSession(db,{email:"print2@example.com",role:"admin",organizationId:2});
    const itemRes=await postInventory(db,org2,{action:"create_item",name:"Папір Org2",category:"paper",unit:"пач",minStock:1});
    const {id:itemId}=await itemRes.json();
    const receipt=await postInventory(db,org2,{action:"receive",itemId,quantity:3,lotNumber:"O2"});
    const {documentId}=await receipt.json();
    const printed=await printDocument(db,org2,documentId);
    const {snapshot}=await printed.json();

    const foreign=await callWorker(new Request(`http://localhost/api/staff/inventory/documents/print?snapshotId=${snapshot.id}`,{headers:{cookie:org1}}),db);
    assert.equal(foreign.status,404);
    const own=await callWorker(new Request(`http://localhost/api/staff/inventory/documents/print?snapshotId=${snapshot.id}`,{headers:{cookie:org2}}),db);
    assert.equal(own.status,200);
  });
});
