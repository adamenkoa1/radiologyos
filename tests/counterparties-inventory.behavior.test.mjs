import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function createCounterparty(db,cookie,body){
  const response=await callWorker(jsonRequest("/api/staff/counterparties",body,{headers:{cookie}}),db);
  const payload=await response.json();
  return {response,payload};
}

async function seedItem(db,organizationId=1,name="Контраст тестовий"){
  const result=await db.prepare(
    "INSERT INTO inventory_items (organization_id,sku,name,category,unit,min_stock) VALUES (?,?,?,'contrast','фл',0)"
  ).bind(organizationId,`SKU-${organizationId}-${Math.random()}`,name).run();
  return Number(result.meta.last_row_id);
}

async function createReceipt(db,cookie,itemId,line={}){
  const response=await callWorker(jsonRequest("/api/staff/inventory/documents",{
    action:"create",documentType:"inventory_receipt",
    lines:[{itemId,quantity:2,lotNumber:"LOT-C",reason:"Надходження",...line}],
  },{headers:{cookie}}),db);
  const payload=await response.json();
  return {response,payload};
}

async function postDocument(db,cookie,documentId){
  return callWorker(jsonRequest("/api/staff/inventory/documents",{action:"post",documentId},{headers:{cookie}}),db);
}

async function printDocument(db,cookie,documentId){
  const response=await callWorker(jsonRequest("/api/staff/inventory/documents/print",{documentId},{headers:{cookie}}),db);
  return {response,payload:await response.json()};
}

test("counterparty directory is tenant scoped and supplier filter does not leak payer-only rows",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Counterparty Org 2','counterparty-org-2',1)");
    const admin1=await seedStaffSession(db,{email:"counterparty-admin1@example.com",role:"admin",organizationId:1});
    const admin2=await seedStaffSession(db,{email:"counterparty-admin2@example.com",role:"admin",organizationId:2});
    const supplier=await createCounterparty(db,admin1,{name:"ТОВ Постачальник 1",code:"SUP-1",kind:"supplier",taxId:"12345678"});
    assert.equal(supplier.response.status,201);
    const payer=await createCounterparty(db,admin1,{name:"ТОВ Платник 1",code:"PAY-1",kind:"payer"});
    assert.equal(payer.response.status,201);
    const foreign=await createCounterparty(db,admin2,{name:"ТОВ Постачальник 2",code:"SUP-2",kind:"supplier"});
    assert.equal(foreign.response.status,201);

    const list=await callWorker(new Request("http://localhost/api/staff/counterparties?kind=supplier&active=1",{headers:{cookie:admin1}}),db);
    assert.equal(list.status,200);
    const body=await list.json();
    assert.deepEqual(body.counterparties.map(row=>row.name),["ТОВ Постачальник 1"]);
    assert.ok(body.counterparties.every(row=>row.organizationId===1));

    const clinician=await seedStaffSession(db,{email:"counterparty-doctor@example.com",role:"radiologist",organizationId:1});
    const denied=await callWorker(new Request("http://localhost/api/staff/counterparties",{headers:{cookie:clinician}}),db);
    assert.equal(denied.status,403);
  });
});

test("receipt stores supplier reference plus immutable snapshot and historical reprint survives rename",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"supplier-receipt@example.com",role:"admin",organizationId:1});
    const itemId=await seedItem(db);
    const createdSupplier=await createCounterparty(db,cookie,{name:"ТОВ Медпостач",code:"MED-1",kind:"supplier"});
    const supplierId=createdSupplier.payload.counterparty.id;

    const draft=await createReceipt(db,cookie,itemId,{supplierCounterpartyId:supplierId});
    assert.equal(draft.response.status,201);
    assert.equal(draft.payload.lines[0].supplierCounterpartyId,supplierId);
    assert.equal(draft.payload.lines[0].supplier,"ТОВ Медпостач");

    const posted=await postDocument(db,cookie,draft.payload.document.id);
    assert.equal(posted.status,200);
    const lot=raw.prepare(
      "SELECT supplier,supplier_counterparty_id AS supplierCounterpartyId FROM inventory_lots WHERE organization_id=1 AND id=?"
    ).get(draft.payload.lines[0].lotId||raw.prepare("SELECT lot_id AS lotId FROM inventory_document_lines WHERE document_id=?").get(draft.payload.document.id).lotId);
    assert.equal(lot.supplier,"ТОВ Медпостач");
    assert.equal(lot.supplierCounterpartyId,supplierId);

    const firstPrint=await printDocument(db,cookie,draft.payload.document.id);
    assert.equal(firstPrint.response.status,201);
    assert.equal(firstPrint.payload.payload.lines[0].supplier,"ТОВ Медпостач");

    const rename=await callWorker(jsonRequest("/api/staff/counterparties",{
      id:supplierId,name:"ТОВ Медпостач НОВА НАЗВА",
    },{method:"PATCH",headers:{cookie}}),db);
    assert.equal(rename.status,200);
    assert.equal(raw.prepare("SELECT supplier FROM inventory_document_lines WHERE document_id=?").get(draft.payload.document.id).supplier,"ТОВ Медпостач");

    const reprint=await printDocument(db,cookie,draft.payload.document.id);
    assert.equal(reprint.response.status,200);
    assert.equal(reprint.payload.snapshot.id,firstPrint.payload.snapshot.id);
    assert.equal(reprint.payload.payload.lines[0].supplier,"ТОВ Медпостач");
    assert.throws(()=>raw.prepare("DELETE FROM counterparties WHERE organization_id=1 AND id=?").run(supplierId),/counterparty_in_use/);
  });
});

test("D1 rejects cross-tenant and payer-only supplier references",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Supplier Org 2','supplier-org-2',1)");
    const itemId=await seedItem(db,1);
    const cross=raw.prepare("INSERT INTO counterparties (organization_id,name,kind) VALUES (2,'Foreign Supplier','supplier')").run();
    const payer=raw.prepare("INSERT INTO counterparties (organization_id,name,kind) VALUES (1,'Local Payer','payer')").run();
    const warehouse=raw.prepare("SELECT id,code,name FROM warehouses WHERE organization_id=1 AND is_default=1 LIMIT 1").get();
    const doc=raw.prepare(
      "INSERT INTO business_documents (organization_id,document_type,number,state,created_by) VALUES (1,'inventory_receipt','НД-REF-GUARD','draft','test@example.com')"
    ).run();
    const insert=(supplierId)=>raw.prepare(
      `INSERT INTO inventory_document_lines
       (organization_id,document_id,line_no,item_id,warehouse_id,warehouse_code,warehouse_name,lot_number,expires_on,supplier,supplier_counterparty_id,quantity,reason)
       VALUES (1,?,1,?,?,?,?, 'LOT','', '',?,1,'test')`
    ).run(Number(doc.lastInsertRowid),itemId,warehouse.id,warehouse.code,warehouse.name,supplierId);
    assert.throws(()=>insert(Number(cross.lastInsertRowid)),/counterparty_supplier_tenant_mismatch/);
    assert.throws(()=>insert(Number(payer.lastInsertRowid)),/counterparty_not_active_supplier/);
  });
});

test("inactive supplier cannot be selected for a new receipt but existing reference stays historical",async()=>{
  await withD1(async(db)=>{
    const cookie=await seedStaffSession(db,{email:"supplier-inactive@example.com",role:"admin",organizationId:1});
    const itemId=await seedItem(db);
    const created=await createCounterparty(db,cookie,{name:"ТОВ Тимчасовий",kind:"supplier"});
    const supplierId=created.payload.counterparty.id;
    const disable=await callWorker(jsonRequest("/api/staff/counterparties",{id:supplierId,active:false},{method:"PATCH",headers:{cookie}}),db);
    assert.equal(disable.status,200);
    const receipt=await createReceipt(db,cookie,itemId,{supplierCounterpartyId:supplierId});
    assert.equal(receipt.response.status,404);
    assert.match(receipt.payload.error,/Постачальника не знайдено/);
  });
});

test("legacy free-text supplier remains compatible without inventing a counterparty link",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"supplier-legacy@example.com",role:"admin",organizationId:1});
    const itemId=await seedItem(db);
    const draft=await createReceipt(db,cookie,itemId,{supplier:"Legacy Supplier Ltd"});
    assert.equal(draft.response.status,201);
    assert.equal(draft.payload.lines[0].supplier,"Legacy Supplier Ltd");
    assert.equal(draft.payload.lines[0].supplierCounterpartyId,null);
    const post=await postDocument(db,cookie,draft.payload.document.id);
    assert.equal(post.status,200);
    const lot=raw.prepare("SELECT supplier,supplier_counterparty_id AS supplierCounterpartyId FROM inventory_lots WHERE supplier='Legacy Supplier Ltd' LIMIT 1").get();
    assert.equal(lot.supplier,"Legacy Supplier Ltd");
    assert.equal(lot.supplierCounterpartyId,null);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM counterparties").get().n,0);
  });
});
