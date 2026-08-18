import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryDocument,postInventoryDocument } from "../lib/inventory-documents.ts";
import { valueInventoryReceipt } from "../lib/supplier-payables.ts";
import { withD1 } from "./helpers/d1.mjs";

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

async function valuedReceipt(db,{itemId,supplierId,quantity=3,unitCost=1,occurredAt="2026-10-05T09:00:00"}){
  const created=await createInventoryDocument(db,{
    organizationId:1,actorEmail:"expense-store@example.com",type:"inventory_receipt",occurredAt,
    comment:"Valued receipt",
    lines:[{itemId,quantity,lotNumber:"EXP-LOT",supplierCounterpartyId:supplierId,reason:"Закупівля"}],
  });
  assert.ok(created?.document?.id);assert.equal(created.lines.length,1);
  const lineId=created.lines[0].id;
  const valued=await valueInventoryReceipt(db,{organizationId:1,documentId:created.document.id,lines:[{lineId,unitCost}]});
  assert.equal(valued.ok,true);
  const posted=await postInventoryDocument(db,{organizationId:1,documentId:created.document.id,actorEmail:"expense-store@example.com"});
  assert.equal(posted.ok,true);
  const line=await db.prepare(`SELECT id,lot_id AS lotId,unit_cost AS unitCost,line_amount AS lineAmount
    FROM inventory_document_lines WHERE organization_id=1 AND id=?`).bind(lineId).first();
  assert.ok(line?.lotId);assert.equal(Number(line.unitCost),unitCost);assert.equal(Number(line.lineAmount),Math.round(quantity*unitCost));
  return {documentId:created.document.id,lineId,lotId:Number(line.lotId),lineAmount:Number(line.lineAmount)};
}

async function writeoff(db,{lotId,quantity,occurredAt,reason="Використано"}){
  const created=await createInventoryDocument(db,{
    organizationId:1,actorEmail:"expense-store@example.com",type:"inventory_writeoff",occurredAt,
    lines:[{lotId,quantity,reason}],
  });
  assert.ok(created?.document?.id);
  const posted=await postInventoryDocument(db,{organizationId:1,documentId:created.document.id,actorEmail:"expense-store@example.com"});
  assert.equal(posted.ok,true);
  return created.document.id;
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
    const {itemId,supplierId}=await seedCatalog(db);
    const receipt=await valuedReceipt(db,{itemId,supplierId,quantity:3,unitCost:1});

    await writeoff(db,{lotId:receipt.lotId,quantity:0.6,occurredAt:"2026-10-05T10:00:00",reason:"Частина 1"});
    await writeoff(db,{lotId:receipt.lotId,quantity:0.6,occurredAt:"2026-10-05T11:00:00",reason:"Частина 2"});
    await writeoff(db,{lotId:receipt.lotId,quantity:1.8,occurredAt:"2026-10-05T12:00:00",reason:"Фінальне списання"});

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
    const stock=raw.prepare("SELECT COALESCE(SUM(quantity_delta),0) AS stock FROM inventory_movements WHERE organization_id=1 AND lot_id=?").get(receipt.lotId);
    assert.ok(Math.abs(Number(stock.stock))<0.000001);

    assert.throws(()=>raw.prepare("UPDATE expense_movements SET amount_delta=99 WHERE id=?").run(rows[0].id),/expense_movement_immutable/);
    assert.throws(()=>raw.prepare("DELETE FROM expense_movements WHERE id=?").run(rows[0].id),/expense_movement_immutable/);
  });
});

test("zero-cost and legacy lots do not invent historical expense",async()=>{
  await withD1(async(db,raw)=>{
    const {itemId}=await seedCatalog(db,{sku:"EXP-ZERO",supplierCode:"EXP-ZERO-SUP"});
    const zero=await createInventoryDocument(db,{
      organizationId:1,actorEmail:"expense-store@example.com",type:"inventory_receipt",occurredAt:"2026-10-06T09:00:00",
      lines:[{itemId,quantity:2,lotNumber:"ZERO-LOT",reason:"Безоплатне надходження"}],
    });
    assert.ok(zero?.document?.id);
    assert.equal((await postInventoryDocument(db,{organizationId:1,documentId:zero.document.id,actorEmail:"expense-store@example.com"})).ok,true);
    const zeroLot=Number(raw.prepare("SELECT lot_id AS lotId FROM inventory_document_lines WHERE document_id=?").get(zero.document.id).lotId);
    await writeoff(db,{lotId:zeroLot,quantity:1,occurredAt:"2026-10-06T10:00:00"});
    assert.equal(expenses(raw,zeroLot).length,0);

    const warehouse=raw.prepare("SELECT id,code,name FROM warehouses WHERE organization_id=1 AND is_default=1 LIMIT 1").get();
    const legacyLotResult=raw.prepare(`INSERT INTO inventory_lots (organization_id,item_id,lot_number,expires_on,supplier)
      VALUES (1,?,'LEGACY-LOT','','')`).run(itemId);
    const legacyLot=Number(legacyLotResult.lastInsertRowid);
    raw.prepare(`INSERT INTO inventory_movements
      (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,reason,actor_email)
      VALUES (1,?,?,?,?,?,'receipt',2,'legacy seed','legacy@example.com')`)
      .run(itemId,legacyLot,warehouse.id,warehouse.code,warehouse.name);
    await writeoff(db,{lotId:legacyLot,quantity:1,occurredAt:"2026-10-06T11:00:00",reason:"Legacy writeoff"});
    assert.equal(expenses(raw,legacyLot).length,0);
  });
});

test("expense registrar rejects a forged receipt source and fails closed on ambiguous lot valuation",async()=>{
  await withD1(async(db,raw)=>{
    const first=await seedCatalog(db,{sku:"EXP-FORGE-A",supplierCode:"EXP-FORGE-SUP-A"});
    const second=await seedCatalog(db,{sku:"EXP-FORGE-B",supplierCode:"EXP-FORGE-SUP-B"});
    const source=await valuedReceipt(db,{itemId:first.itemId,supplierId:first.supplierId,quantity:2,unitCost:10,occurredAt:"2026-10-07T09:00:00"});
    const wrong=await valuedReceipt(db,{itemId:second.itemId,supplierId:second.supplierId,quantity:2,unitCost:20,occurredAt:"2026-10-07T09:10:00"});
    await writeoff(db,{lotId:source.lotId,quantity:0.5,occurredAt:"2026-10-07T10:00:00"});
    const posted=expenses(raw,source.lotId)[0];assert.ok(posted);

    assert.throws(()=>raw.prepare(`INSERT INTO expense_movements
      (organization_id,inventory_movement_id,document_id,document_line_id,source_receipt_document_id,source_receipt_line_id,
       booking_id,item_id,lot_id,warehouse_id,unit_cost,amount_delta,currency,reason,actor_email,occurred_at)
      VALUES (1,?,?,?,?,NULL,?,?,?,?,? ,?,'UAH',?,?,?)`)
      .run(posted.inventoryMovementId,posted.documentId,posted.documentLineId,wrong.documentId,wrong.lineId,
        posted.itemId,posted.lotId,posted.warehouseId,wrong.unitCost||20,posted.amountDelta,posted.reason,posted.actorEmail,posted.occurredAt),
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

    const ambiguous=await createInventoryDocument(db,{
      organizationId:1,actorEmail:"expense-store@example.com",type:"inventory_writeoff",occurredAt:"2026-10-07T11:00:00",
      lines:[{lotId:source.lotId,quantity:0.5,reason:"Ambiguous valuation"}],
    });
    await assert.rejects(
      postInventoryDocument(db,{organizationId:1,documentId:ambiguous.document.id,actorEmail:"expense-store@example.com"}),
      /inventory_lot_valuation_ambiguous/,
    );
    assert.equal(raw.prepare("SELECT state FROM business_documents WHERE id=?").get(ambiguous.document.id).state,"draft");
  });
});
