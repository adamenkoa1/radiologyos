import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {renderPrintedFormHtml} from "../lib/printed-form-render/index.ts";
import {printedFormStorageKey} from "../lib/printed-form-storage-key.ts";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const HASH="c".repeat(64);
const snapshot={id:21,organizationId:1,documentId:91,formType:"inventory_transfer",templateVersion:1,documentState:"posted",payloadJson:"{}",storageKey:"",sha256:HASH};
const payload={
  templateVersion:1,formType:"inventory_transfer",organization:{name:"Hospital"},
  document:{id:91,number:"ПМ-000091",documentType:"inventory_transfer",occurredAt:"2026-08-19T00:00:00Z",state:"posted",comment:"Між складами",createdBy:"admin@example.com",createdAt:"2026-08-19T00:00:00Z",postedBy:"admin@example.com",postedAt:"2026-08-19T00:05:00Z"},
  lines:[{lineNo:1,itemId:7,itemName:"Контраст <script>alert(1)</script>",unit:"фл.",lotId:3,lotNumber:"LOT-7",expiresOn:"2027-01-01",sourceWarehouseId:1,sourceWarehouseCode:"MAIN",sourceWarehouseName:"Основний",destinationWarehouseId:2,destinationWarehouseCode:"CT",destinationWarehouseName:"КТ склад",quantity:2.5,reason:"Переміщення <b>факт</b>"}],
};

test("inventory transfer renderer shows physical route and escapes operator-entered text",()=>{
  const html=renderPrintedFormHtml(snapshot,payload);
  assert.match(html,/Переміщення запасів/);
  assert.match(html,/Склад-відправник/);assert.match(html,/Склад-одержувач/);
  assert.match(html,/Основний/);assert.match(html,/КТ склад/);assert.match(html,/2,5/);
  assert.match(html,/Контраст &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html,/Переміщення &lt;b&gt;факт&lt;\/b&gt;/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html,/грн|Ціна|Сума|unitCost|lineAmount|totalAmount/i);
});

test("inventory transfer PDF storage keys are deterministic and tenant-separated",()=>{
  const one=printedFormStorageKey(snapshot),same=printedFormStorageKey(snapshot),two=printedFormStorageKey({...snapshot,organizationId:2});
  assert.equal(one,same);assert.notEqual(one,two);
  assert.match(one,/^organizations\/1\/printed-forms\/91\/inventory_transfer\/posted\/v1\/[a-f0-9]{64}\.pdf$/);
});

test("inventory transfer snapshot source is tenant-scoped and carries exact warehouses",async()=>{
  const source=await read("app/api/staff/inventory/transfers/print/route.ts");
  assert.match(source,/getInventoryTransfer\(db,ctx\.organizationId,documentId\)/);
  assert.match(source,/getInventoryTransfer\(db,organizationId,documentId\)/);
  assert.match(source,/s\.organization_id=\? AND s\.id=\? AND s\.form_type='inventory_transfer' AND d\.document_type='inventory_transfer'/);
  assert.match(source,/sourceWarehouseId:line\.sourceWarehouseId/);
  assert.match(source,/destinationWarehouseId:line\.destinationWarehouseId/);
  assert.match(source,/quantity:line\.quantity/);
  assert.doesNotMatch(source,/unitCost|lineAmount|totalAmount/);
});

test("posted transfer reprints preserve the earliest snapshot for that exact state",async()=>{
  const source=await read("app/api/staff/inventory/transfers/print/route.ts");
  assert.match(source,/if\(documentState!=="draft"\)/);
  assert.match(source,/form_type='inventory_transfer' AND document_state=\?/);
  assert.match(source,/ORDER BY id ASC LIMIT 1/);
  assert.match(source,/action:"printed_form_reprinted"/);
  assert.match(source,/printedFormStorageKey/);
});

test("generic immutable PDF endpoint authorizes transfer only against matching business document type",async()=>{
  const source=await read("app/api/staff/printed-forms/pdf/route.ts");
  assert.match(source,/row\.formType==="inventory_transfer"/);
  assert.match(source,/return row\.documentType===row\.formType/);
  assert.match(source,/WHERE s\.organization_id=\? AND s\.id=\?/);
});

test("inventory transfer form type is already declared in business core and DB schema",async()=>{
  const [core,migration]=await Promise.all([read("lib/business-core.ts"),read("drizzle/0059_business_inventory_documents.sql")]);
  assert.match(core,/PRINTED_FORM_TYPES[\s\S]*inventory_transfer/);
  assert.match(migration,/form_type[\s\S]*'inventory_transfer'/);
});
