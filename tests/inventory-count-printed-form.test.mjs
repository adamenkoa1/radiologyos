import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {renderPrintedFormHtml} from "../lib/printed-form-render/index.ts";
import {printedFormStorageKey} from "../lib/printed-form-storage-key.ts";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const HASH="b".repeat(64);
const snapshot={id:19,organizationId:1,documentId:88,formType:"inventory_count",templateVersion:1,documentState:"posted",payloadJson:"{}",storageKey:"",sha256:HASH};
const payload={
  templateVersion:1,formType:"inventory_count",organization:{name:"Hospital"},
  document:{id:88,number:"ІНВ-000088",documentType:"inventory_count",occurredAt:"2026-08-19T00:00:00Z",state:"posted",comment:"Планова",createdBy:"admin@example.com",createdAt:"2026-08-19T00:00:00Z",postedBy:"admin@example.com",postedAt:"2026-08-19T00:05:00Z"},
  lines:[{lineNo:1,itemId:7,itemName:"Контраст <script>alert(1)</script>",unit:"фл.",lotId:3,lotNumber:"LOT-7",warehouseId:2,warehouseCode:"CT",warehouseName:"КТ склад",bookQuantity:5,countedQuantity:7,discrepancyQuantity:2,reason:"Перерахунок <b>факт</b>"}],
};

test("inventory count renderer is quantity-only and escapes operator-entered text",()=>{
  const html=renderPrintedFormHtml(snapshot,payload);
  assert.match(html,/Інвентаризація запасів/);
  assert.match(html,/Облік/);assert.match(html,/Факт/);assert.match(html,/Δ/);assert.match(html,/\+2/);
  assert.match(html,/Контраст &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html,/Перерахунок &lt;b&gt;факт&lt;\/b&gt;/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html,/грн|Ціна|Сума|unitCost|lineAmount|totalAmount/i);
});

test("inventory count PDF storage keys are deterministic and tenant-separated",()=>{
  const one=printedFormStorageKey(snapshot),same=printedFormStorageKey(snapshot),two=printedFormStorageKey({...snapshot,organizationId:2});
  assert.equal(one,same);assert.notEqual(one,two);
  assert.match(one,/^organizations\/1\/printed-forms\/88\/inventory_count\/posted\/v1\/[a-f0-9]{64}\.pdf$/);
});

test("inventory count snapshot source is tenant-scoped and uses dedicated count lines",async()=>{
  const source=await read("app/api/staff/inventory/counts/print/route.ts");
  assert.match(source,/getInventoryCount\(db,ctx\.organizationId,documentId\)/);
  assert.match(source,/getInventoryCount\(db,organizationId,documentId\)/);
  assert.match(source,/s\.organization_id=\? AND s\.id=\? AND s\.form_type='inventory_count' AND d\.document_type='inventory_count'/);
  assert.match(source,/bookQuantity:line\.bookQuantity/);
  assert.match(source,/countedQuantity:line\.countedQuantity/);
  assert.match(source,/discrepancyQuantity:line\.discrepancyQuantity/);
  assert.doesNotMatch(source,/inventory_document_lines/);
  assert.doesNotMatch(source,/unitCost|lineAmount|totalAmount/);
});

test("posted count reprints preserve the earliest snapshot for that exact state",async()=>{
  const source=await read("app/api/staff/inventory/counts/print/route.ts");
  assert.match(source,/if\(documentState!=="draft"\)/);
  assert.match(source,/form_type='inventory_count' AND document_state=\?/);
  assert.match(source,/ORDER BY id ASC LIMIT 1/);
  assert.match(source,/action:"printed_form_reprinted"/);
  assert.match(source,/printedFormStorageKey/);
});

test("generic immutable PDF endpoint authorizes count only against the matching business document type",async()=>{
  const source=await read("app/api/staff/printed-forms/pdf/route.ts");
  assert.match(source,/row\.formType==="inventory_receipt"\|\|row\.formType==="inventory_writeoff"\|\|row\.formType==="inventory_count"/);
  assert.match(source,/return row\.documentType===row\.formType/);
  assert.match(source,/WHERE s\.organization_id=\? AND s\.id=\?/);
});

test("inventory count form type is already schema-approved, so this feature needs no migration",async()=>{
  const migration=await read("drizzle/0059_business_inventory_documents.sql");
  assert.match(migration,/form_type[\s\S]*'inventory_count'/);
});
