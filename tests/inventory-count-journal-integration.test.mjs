import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const INVENTORY_PAGE=new URL("../app/staff/inventory/page.tsx",import.meta.url);
const JOURNAL=new URL("../lib/business-document-journal.ts",import.meta.url);

test("inventory movement history labels registrar movement types and routes documents correctly",async()=>{
  const source=await readFile(INVENTORY_PAGE,"utf8");
  assert.match(source,/count_adjustment:\"Інвентаризація\"/);
  assert.match(source,/transfer_out:\"Переміщення: вибуття\"/);
  assert.match(source,/transfer_in:\"Переміщення: надходження\"/);
  assert.match(source,/movement\.movementType===\"count_adjustment\"/);
  assert.ok(source.includes('/staff/inventory/counts?id=${movement.documentId}'));
  assert.match(source,/movement\.movementType===\"transfer_out\"\|\|movement\.movementType===\"transfer_in\"/);
  assert.match(source,/MOVEMENT_UK\[m\.movementType\]\|\|m\.movementType/);
});

test("inventory count is directly reachable from the main inventory workspace",async()=>{
  const source=await readFile(INVENTORY_PAGE,"utf8");
  assert.match(source,/window\.location\.assign\(\"\/staff\/inventory\/counts\"\)/);
});

test("business journal derives inventory-count totals from dedicated immutable count lines",async()=>{
  const source=await readFile(JOURNAL,"utf8");
  assert.match(source,/d\.document_type='inventory_count'/);
  assert.match(source,/COUNT\(\*\) FROM inventory_count_lines ic/);
  assert.match(source,/SUM\(ic\.counted_quantity\) FROM inventory_count_lines ic/);
  assert.match(source,/SUM\(il\.quantity\) FROM inventory_document_lines il/);
});
