import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function postInventory(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory",body,{headers:{cookie}}),db);
}
async function postDocument(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/inventory/documents",body,{headers:{cookie}}),db);
}
async function postPayables(db,cookie,body) {
  return callWorker(jsonRequest("/api/staff/supplier-payables",body,{headers:{cookie}}),db);
}

function seedSupplier(raw,organizationId=1,{code="SUP-1",name="МедПостач",active=1}={}) {
  raw.prepare("INSERT INTO counterparties (organization_id,code,name,kind,active) VALUES (?,?,?,'supplier',?)")
    .run(organizationId,code,name,active);
  return Number(raw.prepare("SELECT id FROM counterparties WHERE organization_id=? AND code=?").get(organizationId,code).id);
}
function seedCash(raw,organizationId=1,{code="BANK-1",name="Основний рахунок"}={}) {
  raw.prepare("INSERT INTO cash_accounts (organization_id,code,name,account_type,currency,active,is_default) VALUES (?,?,?,'bank','UAH',1,0)")
    .run(organizationId,code,name);
  return Number(raw.prepare("SELECT id FROM cash_accounts WHERE organization_id=? AND code=?").get(organizationId,code).id);
}

async function createSupplierReceipt(db,raw,cookie,{supplierId,quantity=5,itemName="Контраст",sku="PAY-ITEM"}) {
  const itemRes=await postInventory(db,cookie,{action:"create_item",name:itemName,sku,category:"contrast",unit:"шт",minStock:1});
  assert.equal(itemRes.status,201);
  const {id:itemId}=await itemRes.json();
  const created=await postDocument(db,cookie,{
    action:"create",documentType:"inventory_receipt",
    lines:[{itemId,quantity,lotNumber:`LOT-${sku}`,supplierCounterpartyId:supplierId}],
  });
  assert.equal(created.status,201);
  return {itemId,draft:await created.json()};
}

async function valueReceipt(db,cookie,draft,unitCost) {
  return postPayables(db,cookie,{action:"value_receipt",documentId:draft.document.id,lines:[{lineId:draft.lines[0].id,unitCost}]});
}

test("legacy supplier trace can post without valuation and creates no payable", async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"purchase-compatible@example.com",role:"admin",organizationId:1});
    const supplierId=seedSupplier(raw);
    const {itemId,draft}=await createSupplierReceipt(db,raw,cookie,{supplierId});
    const response=await postDocument(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(response.status,200);
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(draft.document.id).state,"posted");
    assert.equal(raw.prepare("SELECT COALESCE(SUM(quantity_delta),0) AS n FROM inventory_movements WHERE organization_id=1 AND item_id=?").get(itemId).n,5);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM supplier_payable_movements WHERE organization_id=1 AND receipt_document_id=?").get(draft.document.id).n,0);
  });
});

test("valued receipt posts stock and supplier payable exactly once", async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"purchase-post@example.com",role:"admin",organizationId:1});
    const supplierId=seedSupplier(raw);
    const {itemId,draft}=await createSupplierReceipt(db,raw,cookie,{supplierId,quantity:5});
    assert.equal((await valueReceipt(db,cookie,draft,120)).status,200);
    const posted=await postDocument(db,cookie,{action:"post",documentId:draft.document.id});
    assert.equal(posted.status,200);
    assert.equal(raw.prepare("SELECT SUM(quantity_delta) AS n FROM inventory_movements WHERE organization_id=1 AND item_id=?").get(itemId).n,5);
    const balance=raw.prepare("SELECT balance FROM supplier_payable_balance WHERE organization_id=1 AND supplier_counterparty_id=? AND receipt_document_id=?").get(supplierId,draft.document.id);
    assert.equal(balance.balance,600);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM supplier_payable_movements WHERE organization_id=1 AND receipt_document_id=? AND movement_type='receipt_accrual'").get(draft.document.id).n,1);
    assert.equal((await postDocument(db,cookie,{action:"post",documentId:draft.document.id})).status,200);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM supplier_payable_movements WHERE organization_id=1 AND receipt_document_id=? AND movement_type='receipt_accrual'").get(draft.document.id).n,1);
  });
});

test("partial and final supplier payments reduce exact payable and cash balance", async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"supplier-pay@example.com",role:"admin",organizationId:1});
    const supplierId=seedSupplier(raw);const cashAccountId=seedCash(raw);
    const {draft}=await createSupplierReceipt(db,raw,cookie,{supplierId,quantity:4,sku:"PAY-PARTIAL"});
    assert.equal((await valueReceipt(db,cookie,draft,100)).status,200);
    assert.equal((await postDocument(db,cookie,{action:"post",documentId:draft.document.id})).status,200);

    const partial=await postPayables(db,cookie,{action:"create_payment",supplierId,cashAccountId,allocations:[{receiptDocumentId:draft.document.id,amount:150}]});
    assert.equal(partial.status,201);
    const partialDoc=await partial.json();
    assert.equal((await postPayables(db,cookie,{action:"post_payment",documentId:partialDoc.document.id})).status,200);
    assert.equal(raw.prepare("SELECT balance FROM supplier_payable_balance WHERE organization_id=1 AND supplier_counterparty_id=? AND receipt_document_id=?").get(supplierId,draft.document.id).balance,250);
    assert.equal(raw.prepare("SELECT balance FROM cash_account_balance WHERE organization_id=1 AND cash_account_id=? AND currency='UAH'").get(cashAccountId).balance,-150);

    const finalPayment=await postPayables(db,cookie,{action:"create_payment",supplierId,cashAccountId,allocations:[{receiptDocumentId:draft.document.id,amount:250}]});
    assert.equal(finalPayment.status,201);
    const finalDoc=await finalPayment.json();
    assert.equal((await postPayables(db,cookie,{action:"post_payment",documentId:finalDoc.document.id})).status,200);
    assert.equal(raw.prepare("SELECT balance FROM supplier_payable_balance WHERE organization_id=1 AND supplier_counterparty_id=? AND receipt_document_id=?").get(supplierId,draft.document.id).balance,0);
    assert.equal(raw.prepare("SELECT balance FROM cash_account_balance WHERE organization_id=1 AND cash_account_id=? AND currency='UAH'").get(cashAccountId).balance,-400);
  });
});

test("overpayment is rejected and cancelled draft produces no register movements", async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"supplier-overpay@example.com",role:"admin",organizationId:1});
    const supplierId=seedSupplier(raw);const cashAccountId=seedCash(raw);
    const {draft}=await createSupplierReceipt(db,raw,cookie,{supplierId,quantity:2,sku:"PAY-OVER"});
    await valueReceipt(db,cookie,draft,100);await postDocument(db,cookie,{action:"post",documentId:draft.document.id});
    const over=await postPayables(db,cookie,{action:"create_payment",supplierId,cashAccountId,allocations:[{receiptDocumentId:draft.document.id,amount:201}]});
    assert.equal(over.status,409);

    const created=await postPayables(db,cookie,{action:"create_payment",supplierId,cashAccountId,allocations:[{receiptDocumentId:draft.document.id,amount:50}]});
    assert.equal(created.status,201);const body=await created.json();
    assert.equal((await postPayables(db,cookie,{action:"cancel_payment",documentId:body.document.id})).status,200);
    assert.equal(raw.prepare("SELECT state FROM supplier_payment_documents WHERE id=?").get(body.document.id).state,"cancelled");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM supplier_payable_movements WHERE payment_document_id=?").get(body.document.id).n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM supplier_cash_movements WHERE payment_document_id=?").get(body.document.id).n,0);
  });
});

test("renamed and inactive historical supplier can still be paid without breaking receipt snapshot", async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"supplier-history@example.com",role:"admin",organizationId:1});
    const supplierId=seedSupplier(raw,{code:"SUP-H",name:"Стара назва"});const cashAccountId=seedCash(raw,{code:"BANK-H",name:"Банк"});
    const {draft}=await createSupplierReceipt(db,raw,cookie,{supplierId,quantity:3,sku:"PAY-HIST"});
    await valueReceipt(db,cookie,draft,100);await postDocument(db,cookie,{action:"post",documentId:draft.document.id});
    raw.prepare("UPDATE counterparties SET name='Нова назва',active=0 WHERE organization_id=1 AND id=?").run(supplierId);

    const payment=await postPayables(db,cookie,{action:"create_payment",supplierId,cashAccountId,allocations:[{receiptDocumentId:draft.document.id,amount:300}]});
    assert.equal(payment.status,201);const body=await payment.json();
    assert.equal(body.document.supplierName,"Нова назва");
    assert.equal((await postPayables(db,cookie,{action:"post_payment",documentId:body.document.id})).status,200);
    const movements=raw.prepare("SELECT movement_type,supplier_name,amount_delta FROM supplier_payable_movements WHERE organization_id=1 AND receipt_document_id=? ORDER BY id").all(draft.document.id);
    assert.deepEqual(movements.map(m=>m.supplier_name),["Стара назва","Стара назва"]);
    assert.equal(raw.prepare("SELECT balance FROM supplier_payable_balance WHERE organization_id=1 AND supplier_counterparty_id=? AND receipt_document_id=?").get(supplierId,draft.document.id).balance,0);
  });
});

test("supplier payable registers reject cross-tenant and fabricated movements", async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Org 2','org-2',1)");
    const supplier1=seedSupplier(raw,1,{code:"SUP-O1",name:"Org1 supplier"});
    const cash1=seedCash(raw,1,{code:"BANK-O1",name:"Org1 bank"});
    const supplier2=seedSupplier(raw,2,{code:"SUP-O2",name:"Org2 supplier"});
    assert.throws(()=>raw.prepare(
      `INSERT INTO supplier_payment_documents
       (organization_id,number,supplier_counterparty_id,supplier_code,supplier_name,cash_account_id,cash_account_code,cash_account_name,currency,amount,state,created_by)
       VALUES (1,'X',?,'SUP-O2','Org2 supplier',?,'BANK-O1','Org1 bank','UAH',10,'draft','x')`
    ).run(supplier2,cash1),/supplier_payment_supplier_invalid|FOREIGN KEY/i);
    assert.throws(()=>raw.prepare(
      `INSERT INTO supplier_payable_movements
       (organization_id,supplier_counterparty_id,supplier_name,receipt_document_id,movement_type,amount_delta,currency,actor_email)
       VALUES (1,?,'Org1 supplier',999999,'receipt_accrual',10,'UAH','x')`
    ).run(supplier1),/supplier_payable_receipt_mismatch|FOREIGN KEY/i);
  });
});
