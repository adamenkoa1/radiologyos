import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

test("historical lot remains writable after its supplier master data changes",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"supplier-history@example.com",role:"admin",organizationId:1});
    const item=await db.prepare(
      "INSERT INTO inventory_items (organization_id,sku,name,category,unit,min_stock) VALUES (1,'HIST-SKU','Historical contrast','contrast','фл',0)"
    ).run();
    const itemId=Number(item.meta.last_row_id);

    const supplierResponse=await callWorker(jsonRequest("/api/staff/counterparties",{
      name:"ТОВ Історичний постачальник",code:"HIST-SUP",kind:"supplier",
    },{headers:{cookie}}),db);
    assert.equal(supplierResponse.status,201);
    const supplier=(await supplierResponse.json()).counterparty;

    const receiptResponse=await callWorker(jsonRequest("/api/staff/inventory/documents",{
      action:"create",documentType:"inventory_receipt",
      lines:[{itemId,quantity:5,lotNumber:"HIST-LOT",supplierCounterpartyId:supplier.id,reason:"Надходження"}],
    },{headers:{cookie}}),db);
    assert.equal(receiptResponse.status,201);
    const receipt=await receiptResponse.json();
    const postReceipt=await callWorker(jsonRequest("/api/staff/inventory/documents",{
      action:"post",documentId:receipt.document.id,
    },{headers:{cookie}}),db);
    assert.equal(postReceipt.status,200);
    const receiptLine=raw.prepare(
      "SELECT lot_id AS lotId,supplier,supplier_counterparty_id AS supplierCounterpartyId FROM inventory_document_lines WHERE document_id=? LIMIT 1"
    ).get(receipt.document.id);
    assert.equal(receiptLine.supplier,"ТОВ Історичний постачальник");

    const changeMaster=await callWorker(jsonRequest("/api/staff/counterparties",{
      id:supplier.id,name:"ТОВ Нова назва",kind:"payer",active:false,
    },{method:"PATCH",headers:{cookie}}),db);
    assert.equal(changeMaster.status,200);

    const writeoffResponse=await callWorker(jsonRequest("/api/staff/inventory/documents",{
      action:"create",documentType:"inventory_writeoff",
      lines:[{lotId:receiptLine.lotId,quantity:2,reason:"Використано після зміни довідника"}],
    },{headers:{cookie}}),db);
    assert.equal(writeoffResponse.status,201);
    const writeoff=await writeoffResponse.json();
    assert.equal(writeoff.lines[0].supplier,"ТОВ Історичний постачальник");
    assert.equal(writeoff.lines[0].supplierCounterpartyId,supplier.id);
    const postWriteoff=await callWorker(jsonRequest("/api/staff/inventory/documents",{
      action:"post",documentId:writeoff.document.id,
    },{headers:{cookie}}),db);
    assert.equal(postWriteoff.status,200);
    assert.equal(raw.prepare(
      "SELECT COALESCE(SUM(quantity_delta),0) AS stock FROM inventory_movements WHERE organization_id=1 AND lot_id=?"
    ).get(receiptLine.lotId).stock,3);

    const forgedDoc=raw.prepare(
      "INSERT INTO business_documents (organization_id,document_type,number,state,created_by) VALUES (1,'inventory_writeoff','СП-FORGED-SUP','draft','test@example.com')"
    ).run();
    const other=raw.prepare("INSERT INTO counterparties (organization_id,name,kind) VALUES (1,'Other Supplier','supplier')").run();
    assert.throws(()=>raw.prepare(
      `INSERT INTO inventory_document_lines
       (organization_id,document_id,line_no,item_id,lot_id,lot_number,expires_on,supplier,supplier_counterparty_id,quantity,reason)
       VALUES (1,?,1,?,?,'HIST-LOT','','Other Supplier',?,1,'forged')`
    ).run(Number(forgedDoc.lastInsertRowid),itemId,receiptLine.lotId,Number(other.lastInsertRowid)),/inventory_writeoff_supplier_trace_mismatch/);
  });
});
