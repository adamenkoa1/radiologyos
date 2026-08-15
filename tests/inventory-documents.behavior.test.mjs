import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function postInventory(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory",body,{headers:{cookie}}),db);
}

async function postDocument(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory/documents",body,{headers:{cookie}}),db);
}

async function patchDocument(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory/documents",body,{method:"PATCH",headers:{cookie}}),db);
}

test("inventory receipt draft does not affect stock, posting does exactly once", async () => {
  await withD1(async (db,raw)=>{
    const cookie = await seedStaffSession(db,{email:"warehouse@example.com",role:"admin",organizationId:1});
    const itemRes = await postInventory(db,cookie,{action:"create_item",name:"Контраст 350",sku:"DOC-CT",category:"contrast",unit:"фл",minStock:2});
    const {id:itemId} = await itemRes.json();

    const create = await postDocument(db,cookie,{
      action:"create",documentType:"inventory_receipt",comment:"Поставка №1",
      lines:[{itemId,quantity:5,lotNumber:"LOT-DOC-1",expiresOn:"2027-06-01",supplier:"Постачальник"}],
    });
    assert.equal(create.status,201);
    const draft = await create.json();
    assert.equal(draft.document.state,"draft");
    assert.match(draft.document.number,/^НД-\d{6}$/);
    assert.equal(raw.prepare("SELECT COALESCE(SUM(quantity_delta),0) AS stock FROM inventory_movements WHERE organization_id=1 AND item_id=?").get(itemId).stock,0);

    const posted = await postDocument(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(posted.status,200);
    const postedBody = await posted.json();
    assert.equal(postedBody.document.state,"posted");
    assert.ok(postedBody.lines[0].lotId > 0);

    const movement = raw.prepare(
      "SELECT quantity_delta,document_id,document_line_id FROM inventory_movements WHERE organization_id=1 AND item_id=?"
    ).get(itemId);
    assert.equal(movement.quantity_delta,5);
    assert.equal(movement.document_id,draft.document.id);
    assert.equal(movement.document_line_id,draft.lines[0].id);

    const replay = await postDocument(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(replay.status,200);
    const count = raw.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE organization_id=1 AND document_id=?").get(draft.document.id);
    assert.equal(count.count,1,"reposting must not duplicate register movements");
  });
});

test("posted warehouse facts are immutable in API and D1", async () => {
  await withD1(async (db,raw)=>{
    const cookie = await seedStaffSession(db,{email:"immutable@example.com",role:"admin",organizationId:1});
    const itemRes = await postInventory(db,cookie,{action:"create_item",name:"Катетер",category:"catheter",unit:"шт",minStock:1});
    const {id:itemId} = await itemRes.json();
    const created = await postDocument(db,cookie,{
      action:"create",documentType:"inventory_receipt",lines:[{itemId,quantity:3,lotNumber:"IMM-1"}],
    });
    const draft = await created.json();
    assert.equal((await postDocument(db,cookie,{action:"post",documentId:draft.document.id})).status,200);

    const patch = await patchDocument(db,cookie,{documentId:draft.document.id,comment:"тиха підміна"});
    assert.equal(patch.status,409);

    assert.throws(()=>raw.prepare("UPDATE inventory_document_lines SET quantity=99 WHERE id=?").run(draft.lines[0].id),/inventory_document_not_draft/);
    assert.throws(()=>raw.prepare("DELETE FROM business_documents WHERE id=?").run(draft.document.id),/business_document_immutable/);
    const stock = raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE document_id=?").get(draft.document.id);
    assert.equal(stock.stock,3);
  });
});

test("writeoff posting fails closed before any movement when stock is insufficient", async () => {
  await withD1(async (db,raw)=>{
    const cookie = await seedStaffSession(db,{email:"writeoff-doc@example.com",role:"admin",organizationId:1});
    const itemRes = await postInventory(db,cookie,{action:"create_item",name:"Шприц",category:"syringe",unit:"шт",minStock:1});
    const {id:itemId} = await itemRes.json();
    const receipt = await postInventory(db,cookie,{action:"receive",itemId,quantity:2,lotNumber:"WR-1"});
    const {lotId} = await receipt.json();

    const create = await postDocument(db,cookie,{
      action:"create",documentType:"inventory_writeoff",lines:[{lotId,quantity:3,reason:"Надлишкове списання"}],
    });
    assert.equal(create.status,201);
    const draft = await create.json();
    const before = raw.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE organization_id=1 AND lot_id=?").get(lotId).count;

    const post = await postDocument(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(post.status,409);
    const after = raw.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE organization_id=1 AND lot_id=?").get(lotId).count;
    assert.equal(after,before,"failed posting must not create a partial writeoff movement");
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(draft.document.id).state,"draft");
  });
});

test("warehouse documents and referenced lots remain tenant scoped", async () => {
  await withD1(async (db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Org 2','org-2',1)");
    const org1 = await seedStaffSession(db,{email:"doc-org1@example.com",role:"admin",organizationId:1});
    const org2 = await seedStaffSession(db,{email:"doc-org2@example.com",role:"admin",organizationId:2});
    const item = await postInventory(db,org2,{action:"create_item",name:"Плівка",sku:"O2-F",category:"film",unit:"уп",minStock:1});
    const {id:itemId} = await item.json();
    const receipt = await postInventory(db,org2,{action:"receive",itemId,quantity:4,lotNumber:"ORG2"});
    const {lotId,documentId} = await receipt.json();

    const foreignGet = await callWorker(new Request(`http://localhost/api/staff/inventory/documents?id=${documentId}`,{headers:{cookie:org1}}),db);
    assert.equal(foreignGet.status,404);
    const foreignWriteoff = await postDocument(db,org1,{
      action:"create",documentType:"inventory_writeoff",lines:[{lotId,quantity:1,reason:"foreign"}],
    });
    assert.equal(foreignWriteoff.status,404);

    const org2Get = await callWorker(new Request(`http://localhost/api/staff/inventory/documents?id=${documentId}`,{headers:{cookie:org2}}),db);
    assert.equal(org2Get.status,200);
  });
});

test("legacy unlinked movements stay valid and are not guessed into documents", async () => {
  await withD1(async (db,raw)=>{
    const cookie = await seedStaffSession(db,{email:"legacy-stock@example.com",role:"admin",organizationId:1});
    const itemRes = await postInventory(db,cookie,{action:"create_item",name:"Папір",category:"paper",unit:"пач",minStock:1});
    const {id:itemId} = await itemRes.json();
    raw.prepare("INSERT INTO inventory_lots (organization_id,item_id,lot_number) VALUES (1,?,'LEGACY')").run(itemId);
    const lotId = Number(raw.prepare("SELECT id FROM inventory_lots WHERE organization_id=1 AND item_id=? AND lot_number='LEGACY'").get(itemId).id);
    raw.prepare(
      "INSERT INTO inventory_movements (organization_id,item_id,lot_id,movement_type,quantity_delta,reason,actor_email) VALUES (1,?,?,'receipt',7,'legacy','old@example.com')"
    ).run(itemId,lotId);

    const row = raw.prepare("SELECT document_id,document_line_id FROM inventory_movements WHERE organization_id=1 AND lot_id=?").get(lotId);
    assert.equal(row.document_id,null);
    assert.equal(row.document_line_id,null);
    const list = await callWorker(new Request("http://localhost/api/staff/inventory",{headers:{cookie}}),db);
    assert.equal(list.status,200);
    const payload = await list.json();
    const movement = payload.movements.find((m)=>m.lotId===lotId);
    assert.equal(movement.documentId,null);
  });
});
