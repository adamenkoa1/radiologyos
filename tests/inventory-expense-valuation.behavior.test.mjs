import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function postDocument(db,cookie,body){
  return callWorker(jsonRequest("/api/staff/inventory/documents",body,{headers:{cookie}}),db);
}
async function postPayables(db,cookie,body){
  return callWorker(jsonRequest("/api/staff/supplier-payables",body,{headers:{cookie}}),db);
}
async function registerReport(db,cookie,from,to){
  return callWorker(new Request(`http://localhost/api/staff/reports/registers?from=${from}&to=${to}`,{headers:{cookie}}),db);
}

async function seedCatalog(db,{sku="EXP-ITEM",supplierCode="EXP-SUP"}={}){
  const itemResult=await db.prepare(
    `INSERT INTO inventory_items (organization_id,sku,name,category,unit,min_stock,active)
     VALUES (1,?,'Витратний матеріал','other','шт',0,1)`
  ).bind(sku).run();
  const supplierResult=await db.prepare(
    `INSERT INTO counterparties (organization_id,code,name,kind,active)
     VALUES (1,?,'Expense Supplier','supplier',1)`
  ).bind(supplierCode).run();
  return {itemId:Number(itemResult.meta.last_row_id),supplierId:Number(supplierResult.meta.last_row_id)};
}

async function valuedReceipt(db,cookie,{itemId,supplierId,quantity=3,unitCost=1,occurredAt="2026-10-05T09:00:00",lotNumber="EXP-LOT"}){
  const create=await postDocument(db,cookie,{
    action:"create",documentType:"inventory_receipt",occurredAt,comment:"Valued receipt",
    lines:[{itemId,quantity,lotNumber,supplierCounterpartyId:supplierId,reason:"Закупівля"}],
  });
  assert.equal(create.status,201);
  const created=await create.json();
  assert.ok(created?.document?.id);assert.equal(created.lines.length,1);
  const lineId=created.lines[0].id;
  const valued=await postPayables(db,cookie,{action:"value_receipt",documentId:created.document.id,lines:[{lineId,unitCost}]});
  assert.equal(valued.status,200);
  const posted=await postDocument(db,cookie,{action:"post",documentId:created.document.id});
  assert.equal(posted.status,200);
  const line=await db.prepare(`SELECT id,lot_id AS lotId,unit_cost AS unitCost,line_amount AS lineAmount
    FROM inventory_document_lines WHERE organization_id=1 AND id=?`).bind(lineId).first();
  assert.ok(line?.lotId);assert.equal(Number(line.unitCost),unitCost);assert.equal(Number(line.lineAmount),Math.round(quantity*unitCost));
  return {documentId:created.document.id,lineId,lotId:Number(line.lotId),lineAmount:Number(line.lineAmount)};
}

async function writeoff(db,cookie,{lotId,quantity,occurredAt,reason="Використано"}){
  const create=await postDocument(db,cookie,{
    action:"create",documentType:"inventory_writeoff",occurredAt,lines:[{lotId,quantity,reason}],
  });
  assert.equal(create.status,201);
  const created=await create.json();
  const posted=await postDocument(db,cookie,{action:"post",documentId:created.document.id});
  assert.equal(posted.status,200);
  return created;
}

function expenses(raw,lotId){
  return raw.prepare(`SELECT id,inventory_movement_id AS inventoryMovementId,document_id AS documentId,
      document_line_id AS documentLineId,source_receipt_document_id AS sourceReceiptDocumentId,
      source_receipt_line_id AS sourceReceiptLineId,item_id AS itemId,lot_id AS lotId,warehouse_id AS warehouseId,
      unit_cost AS unitCost,amount_delta AS amountDelta,currency,reason,actor_email AS actorEmail,occurred_at AS occurredAt
    FROM expense_movements WHERE organization_id=1 AND lot_id=? ORDER BY id`).all(lotId);
}

test("valued lot writeoffs create exact immutable expense movements and exhaust receipt value without rounding drift",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"expense-store@example.com",role:"admin",organizationId:1});
    const {itemId,supplierId}=await seedCatalog(db);
    const receipt=await valuedReceipt(db,cookie,{itemId,supplierId,quantity:3,unitCost:1});

    await writeoff(db,cookie,{lotId:receipt.lotId,quantity:0.6,occurredAt:"2026-10-05T10:00:00",reason:"Частина 1"});
    await writeoff(db,cookie,{lotId:receipt.lotId,quantity:0.6,occurredAt:"2026-10-05T11:00:00",reason:"Частина 2"});
    await writeoff(db,cookie,{lotId:receipt.lotId,quantity:1.8,occurredAt:"2026-10-05T12:00:00",reason:"Фінальне списання"});

    const rows=expenses(raw,receipt.lotId);
    assert.equal(rows.length,3);
    assert.deepEqual(rows.map(row=>Number(row.amountDelta)),[1,1,1]);
    assert.equal(rows.reduce((sum,row)=>sum+Number(row.amountDelta),0),receipt.lineAmount);
    assert.ok(rows.every(row=>Number(row.sourceReceiptDocumentId)===receipt.documentId));
    assert.ok(rows.every(row=>Number(row.sourceReceiptLineId)===receipt.lineId));
    assert.ok(rows.every(row=>Number(row.unitCost)===1&&row.currency==="UAH"));
    assert.deepEqual(rows.map(row=>row.occurredAt),[
      "2026-10-05T10:00:00","2026-10-05T11:00:00","2026-10-05T12:00:00",
    ]);

    const reportResponse=await registerReport(db,cookie,"2026-10-01","2026-10-31");
    assert.equal(reportResponse.status,200);
    const report=await reportResponse.json();
    assert.equal(report.registers.expenses.increase,3);
    assert.equal(report.registers.expenses.decrease,0);
    assert.equal(report.registers.expenses.net,3);
    const expenseItem=report.breakdowns.expensesByItem.find(row=>Number(row.itemId)===itemId);
    assert.ok(expenseItem);assert.equal(Number(expenseItem.amount),3);assert.equal(Number(expenseItem.movementCount),3);

    const stock=raw.prepare("SELECT COALESCE(SUM(quantity_delta),0) AS stock FROM inventory_movements WHERE organization_id=1 AND lot_id=?").get(receipt.lotId);
    assert.ok(Math.abs(Number(stock.stock))<0.000001);
    assert.throws(()=>raw.prepare("UPDATE expense_movements SET amount_delta=99 WHERE id=?").run(rows[0].id),/expense_movement_immutable/);
    assert.throws(()=>raw.prepare("DELETE FROM expense_movements WHERE id=?").run(rows[0].id),/expense_movement_immutable/);
  });
});

test("zero-cost and legacy lots do not invent historical expense",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"expense-zero@example.com",role:"admin",organizationId:1});
    const {itemId}=await seedCatalog(db,{sku:"EXP-ZERO",supplierCode:"EXP-ZERO-SUP"});
    const create=await postDocument(db,cookie,{
      action:"create",documentType:"inventory_receipt",occurredAt:"2026-10-06T09:00:00",
      lines:[{itemId,quantity:2,lotNumber:"ZERO-LOT",reason:"Безоплатне надходження"}],
    });
    assert.equal(create.status,201);const zero=await create.json();
    assert.equal((await postDocument(db,cookie,{action:"post",documentId:zero.document.id})).status,200);
    const zeroLot=Number(raw.prepare("SELECT lot_id AS lotId FROM inventory_document_lines WHERE document_id=?").get(zero.document.id).lotId);
    await writeoff(db,cookie,{lotId:zeroLot,quantity:1,occurredAt:"2026-10-06T10:00:00"});
    assert.equal(expenses(raw,zeroLot).length,0);

    const warehouse=raw.prepare("SELECT id,code,name FROM warehouses WHERE organization_id=1 AND is_default=1 LIMIT 1").get();
    const legacyLotResult=raw.prepare(`INSERT INTO inventory_lots (organization_id,item_id,lot_number,expires_on,supplier)
      VALUES (1,?,'LEGACY-LOT','','')`).run(itemId);
    const legacyLot=Number(legacyLotResult.lastInsertRowid);
    raw.prepare(`INSERT INTO inventory_movements
      (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email)
      VALUES (1,?,?,?,?,?,'receipt',2,'legacy seed','legacy@example.com')`)
      .run(itemId,legacyLot,warehouse.id,warehouse.code,warehouse.name);
    await writeoff(db,cookie,{lotId:legacyLot,quantity:1,occurredAt:"2026-10-06T11:00:00",reason:"Legacy writeoff"});
    assert.equal(expenses(raw,legacyLot).length,0);
  });
});

test("expense registrar rejects a forged receipt source and fails closed on ambiguous lot valuation",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"expense-forge@example.com",role:"admin",organizationId:1});
    const first=await seedCatalog(db,{sku:"EXP-FORGE-A",supplierCode:"EXP-FORGE-SUP-A"});
    const second=await seedCatalog(db,{sku:"EXP-FORGE-B",supplierCode:"EXP-FORGE-SUP-B"});
    const source=await valuedReceipt(db,cookie,{itemId:first.itemId,supplierId:first.supplierId,quantity:2,unitCost:10,occurredAt:"2026-10-07T09:00:00",lotNumber:"EXP-FORGE-LOT-A"});
    const wrong=await valuedReceipt(db,cookie,{itemId:second.itemId,supplierId:second.supplierId,quantity:2,unitCost:20,occurredAt:"2026-10-07T09:10:00",lotNumber:"EXP-FORGE-LOT-B"});
    await writeoff(db,cookie,{lotId:source.lotId,quantity:0.5,occurredAt:"2026-10-07T10:00:00"});
    const posted=expenses(raw,source.lotId)[0];assert.ok(posted);

    assert.throws(()=>raw.prepare(`INSERT INTO expense_movements
      (organization_id,inventory_movement_id,document_id,document_line_id,source_receipt_document_id,source_receipt_line_id,
       booking_id,item_id,lot_id,warehouse_id,unit_cost,amount_delta,currency,reason,actor_email,occurred_at)
      VALUES (1,?,?,?,?,?,NULL,?,?,?,?,?,'UAH',?,?,?)`)
      .run(posted.inventoryMovementId,posted.documentId,posted.documentLineId,wrong.documentId,wrong.lineId,
        posted.itemId,posted.lotId,posted.warehouseId,20,posted.amountDelta,posted.reason,posted.actorEmail,posted.occurredAt),
      /expense_movement_source_mismatch|UNIQUE/);

    const template=raw.prepare(`SELECT warehouse_id AS warehouseId,warehouse_code AS warehouseCode,warehouse_name AS warehouseName,
      lot_number AS lotNumber,expires_on AS expiresOn,supplier
      FROM inventory_document_lines WHERE organization_id=1 AND id=?`).get(source.lineId);
    const fakeDoc=raw.prepare(`INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by)
      VALUES (1,'inventory_receipt','НД-AMBIG','2026-10-07T10:30:00','draft','ambiguous source','test')`).run();
    const fakeDocId=Number(fakeDoc.lastInsertRowid);
    raw.prepare(`INSERT INTO inventory_document_lines
      (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
       lot_number,expires_on,supplier,quantity,reason)
      VALUES (1,?,1,?,?,?,?,?,?,?,?,0.1,'ambiguous source')`)
      .run(fakeDocId,first.itemId,source.lotId,template.warehouseId,template.warehouseCode,template.warehouseName,
        template.lotNumber,template.expiresOn,template.supplier);
    raw.prepare("UPDATE business_documents SET state='posted',posted_by='test',posted_at='2026-10-07T10:30:00' WHERE id=?").run(fakeDocId);

    const create=await postDocument(db,cookie,{
      action:"create",documentType:"inventory_writeoff",occurredAt:"2026-10-07T11:00:00",
      lines:[{lotId:source.lotId,quantity:0.5,reason:"Ambiguous valuation"}],
    });
    assert.equal(create.status,201);const ambiguous=await create.json();const line=ambiguous.lines[0];
    await assert.rejects(db.batch([
      db.prepare("UPDATE business_documents SET state='posted',posted_by=?,posted_at=? WHERE organization_id=1 AND id=? AND state='draft'")
        .bind("expense-forge@example.com","2026-10-07T11:00:00",ambiguous.document.id),
      db.prepare(`INSERT INTO inventory_movements
        (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,booking_id,actor_email,document_id,document_line_id)
        VALUES (1,?,?,?,?,?,'writeoff',?,?,?,?,?,?)`)
        .bind(line.itemId,line.lotId,line.warehouseId,line.warehouseCode,line.warehouseName,-Number(line.quantity),line.reason,line.bookingId,"expense-forge@example.com",ambiguous.document.id,line.id),
    ]),/inventory_lot_valuation_ambiguous/);
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(ambiguous.document.id).state,"draft");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE document_id=?").get(ambiguous.document.id).n,0);
  });
});
