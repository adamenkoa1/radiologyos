import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function postInventory(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory", body, { headers:{ cookie } }), db);
}

test("inventory items, lots and movements are tenant scoped", async () => {
  await withD1(async (db,raw) => {
    raw.exec("INSERT OR IGNORE INTO organizations (id, name, slug, active) VALUES (2, 'Org 2', 'org-2', 1)");
    const org1 = await seedStaffSession(db,{ email:"admin1@example.com", role:"admin", organizationId:1 });
    const org2 = await seedStaffSession(db,{ email:"admin2@example.com", role:"admin", organizationId:2 });

    const create = await postInventory(db,org2,{ action:"create_item", name:"Контраст 350", sku:"CT-350", category:"contrast", unit:"фл", minStock:5 });
    assert.equal(create.status,201);
    const { id:itemId } = await create.json();

    const receive = await postInventory(db,org2,{ action:"receive", itemId, quantity:12, lotNumber:"LOT-2", expiresOn:"2027-03-01", supplier:"Supplier" });
    assert.equal(receive.status,201);
    const { lotId } = await receive.json();

    const org2List = await callWorker(new Request("http://localhost/api/staff/inventory",{ headers:{cookie:org2} }),db);
    assert.equal(org2List.status,200);
    const p2 = await org2List.json();
    assert.equal(p2.items.length,1);
    assert.equal(p2.items[0].stock,12);
    assert.equal(p2.lots[0].id,lotId);

    const org1List = await callWorker(new Request("http://localhost/api/staff/inventory",{ headers:{cookie:org1} }),db);
    assert.equal(org1List.status,200);
    const p1 = await org1List.json();
    assert.equal(p1.items.some((i)=>i.id===itemId),false);
    assert.equal(p1.lots.some((l)=>l.id===lotId),false);

    const crossWriteoff = await postInventory(db,org1,{ action:"writeoff", lotId, quantity:1, reason:"cross tenant" });
    assert.equal(crossWriteoff.status,404);

    const audit = raw.prepare("SELECT organization_id, action FROM security_audit_log WHERE action='inventory_received' ORDER BY id DESC LIMIT 1").get();
    assert.equal(audit.organization_id,2);
  });
});

test("inventory ledger prevents negative stock and records write-offs", async () => {
  await withD1(async (db,raw) => {
    const admin = await seedStaffSession(db,{ email:"stock@example.com", role:"admin", organizationId:1 });
    const create = await postInventory(db,admin,{ action:"create_item", name:"Катетер 18G", category:"catheter", unit:"шт", minStock:10 });
    const { id:itemId } = await create.json();
    const receipt = await postInventory(db,admin,{ action:"receive", itemId, quantity:3, lotNumber:"A18" });
    const { lotId } = await receipt.json();

    const good = await postInventory(db,admin,{ action:"writeoff", lotId, quantity:2, reason:"Використано" });
    assert.equal(good.status,200);
    const balance = raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE lot_id=?").get(lotId);
    assert.equal(balance.stock,1);

    const tooMuch = await postInventory(db,admin,{ action:"writeoff", lotId, quantity:2, reason:"Не повинно пройти" });
    assert.equal(tooMuch.status,409);
    const after = raw.prepare("SELECT SUM(quantity_delta) AS stock FROM inventory_movements WHERE lot_id=?").get(lotId);
    assert.equal(after.stock,1);
  });
});

test("radiologist can read inventory but cannot mutate stock", async () => {
  await withD1(async (db) => {
    const doctor = await seedStaffSession(db,{ email:"doctor@example.com", role:"radiologist", organizationId:1 });
    const list = await callWorker(new Request("http://localhost/api/staff/inventory",{ headers:{cookie:doctor} }),db);
    assert.equal(list.status,200);
    const payload = await list.json();
    assert.equal(payload.canManage,false);

    const create = await postInventory(db,doctor,{ action:"create_item", name:"Шприц", category:"syringe", unit:"шт", minStock:10 });
    assert.equal(create.status,403);
  });
});
