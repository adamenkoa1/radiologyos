import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function postInventory(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory",body,{headers:{cookie}}),db);
}
async function postDocument(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory/documents",body,{headers:{cookie}}),db);
}

test("inventory register is append-only and draft tenant identity cannot be tampered",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Org 2','org-2',1)");
    const org1=await seedStaffSession(db,{email:"hardening1@example.com",role:"admin",organizationId:1});
    const org2=await seedStaffSession(db,{email:"hardening2@example.com",role:"admin",organizationId:2});

    const item1=await postInventory(db,org1,{action:"create_item",name:"Org1 item",category:"other",unit:"шт",minStock:0});
    const {id:item1Id}=await item1.json();
    const receipt=await postInventory(db,org1,{action:"receive",itemId:item1Id,quantity:2,lotNumber:"HARD-1"});
    const {documentId}=await receipt.json();
    const movement=raw.prepare("SELECT id FROM inventory_movements WHERE organization_id=1 AND document_id=?").get(documentId);

    assert.throws(()=>raw.prepare("UPDATE inventory_movements SET quantity_delta=999 WHERE id=?").run(movement.id),/inventory_movement_immutable/);
    assert.throws(()=>raw.prepare("DELETE FROM inventory_movements WHERE id=?").run(movement.id),/inventory_movement_immutable/);

    const item2=await postInventory(db,org2,{action:"create_item",name:"Org2 item",category:"other",unit:"шт",minStock:0});
    const {id:item2Id}=await item2.json();
    const draftRes=await postDocument(db,org1,{
      action:"create",documentType:"inventory_receipt",lines:[{itemId:item1Id,quantity:1,lotNumber:"DRAFT"}],
    });
    const draft=await draftRes.json();

    assert.throws(
      ()=>raw.prepare("UPDATE business_documents SET organization_id=2 WHERE id=?").run(draft.document.id),
      /business_document_identity_immutable/,
    );
    assert.throws(
      ()=>raw.prepare("UPDATE business_documents SET document_type='payment' WHERE id=?").run(draft.document.id),
      /business_document_identity_immutable/,
    );
    assert.throws(
      ()=>raw.prepare("UPDATE inventory_document_lines SET item_id=? WHERE id=?").run(item2Id,draft.lines[0].id),
      /inventory_item_tenant_mismatch/,
    );
  });
});

test("D1 rejects movement quantity/type mismatches and atomically prevents negative stock",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"atomic-stock@example.com",role:"admin",organizationId:1});
    const itemRes=await postInventory(db,cookie,{action:"create_item",name:"Atomic item",category:"other",unit:"шт",minStock:0});
    const {id:itemId}=await itemRes.json();
    const receipt=await postInventory(db,cookie,{action:"receive",itemId,quantity:1,lotNumber:"ATOMIC"});
    const {lotId}=await receipt.json();

    const writeoffRes=await postDocument(db,cookie,{
      action:"create",documentType:"inventory_writeoff",lines:[{lotId,quantity:2,reason:"Race protected"}],
    });
    const writeoff=await writeoffRes.json();
    const line=writeoff.lines[0];
    raw.prepare(
      "UPDATE business_documents SET state='posted',posted_by='test',posted_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=1"
    ).run(writeoff.document.id);

    // Supply the exact warehouse identity/snapshot so this assertion reaches the intended
    // movement-type registrar check rather than failing earlier on the warehouse dimension.
    assert.throws(()=>raw.prepare(
      `INSERT INTO inventory_movements
       (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email,document_id,document_line_id)
       VALUES (1,?,?,?,?,?,'receipt',2,'Race protected','test',?,?)`
    ).run(itemId,lotId,line.warehouseId,line.warehouseCode,line.warehouseName,writeoff.document.id,line.id),/inventory_document_link_invalid/);

    // With every registrar field valid, an oversized write-off must reach the atomic
    // warehouse+lot non-negative stock guard and be rejected there.
    assert.throws(()=>raw.prepare(
      `INSERT INTO inventory_movements
       (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email,document_id,document_line_id)
       VALUES (1,?,?,?,?,?,'writeoff',-2,'Race protected','test',?,?)`
    ).run(itemId,lotId,line.warehouseId,line.warehouseCode,line.warehouseName,writeoff.document.id,line.id),/inventory_negative_stock/);

    const balance=raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE organization_id=1 AND lot_id=?").get(lotId);
    assert.equal(balance.stock,1);
  });
});

test("inventory printed snapshot must match exact document tenant type and state",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"snapshot-hardening@example.com",role:"admin",organizationId:1});
    const itemRes=await postInventory(db,cookie,{action:"create_item",name:"Snapshot item",category:"other",unit:"шт",minStock:0});
    const {id:itemId}=await itemRes.json();
    const receipt=await postInventory(db,cookie,{action:"receive",itemId,quantity:1,lotNumber:"SNAP"});
    const {documentId}=await receipt.json();

    assert.throws(()=>raw.prepare(
      `INSERT INTO printed_form_snapshots
       (organization_id,document_id,form_type,template_version,document_state,payload_json,generated_by,sha256)
       VALUES (1,?,'inventory_receipt',1,'draft','{}','tamper','deadbeef')`
    ).run(documentId),/printed_form_document_mismatch/);

    assert.throws(()=>raw.prepare(
      `INSERT INTO printed_form_snapshots
       (organization_id,document_id,form_type,template_version,document_state,payload_json,generated_by,sha256)
       VALUES (1,?,'inventory_writeoff',1,'posted','{}','tamper','deadbeef2')`
    ).run(documentId),/printed_form_document_mismatch/);
  });
});
