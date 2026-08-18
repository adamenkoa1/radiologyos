import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const PAGE=new URL("../app/staff/inventory/counts/page.tsx",import.meta.url);

test("inventory count workspace opens an exact document from movement links",async()=>{
  const source=await readFile(PAGE,"utf8");
  assert.match(source,/searchParams\.get\("id"\)/);
  assert.match(source,/Number\.isInteger\(requested\)/);
  assert.match(source,/openDocument\(requested\)/);
  assert.match(source,/fetch\(`\/api\/staff\/inventory\/counts\?id=\$\{id\}`/);
});

test("count sheet can add a known lot with zero balance on the selected warehouse",async()=>{
  const source=await readFile(PAGE,"utf8");
  assert.match(source,/type InventoryPayload=\{[^\n]*lots:Lot\[\]/);
  assert.match(source,/const positiveHere=new Set\(warehouseBalances\.map\(row=>row\.lotId\)\)/);
  assert.match(source,/inventory\.lots\.filter\(lot=>!positiveHere\.has\(lot\.id\)&&!usedHere\.has\(lot\.id\)\)/);
  assert.match(source,/bookQuantity:0/);
  assert.match(source,/countedQuantity:\"0\"/);
  assert.match(source,/Партія без залишку на цьому складі/);
});

test("zero-bucket UI still leaves the canonical book snapshot to the server",async()=>{
  const source=await readFile(PAGE,"utf8");
  assert.match(source,/lines:normalized\.map\(line=>\(\{warehouseId:line\.warehouseId,lotId:line\.lotId,countedQuantity:line\.countedQuantity,reason:line\.reason\}\)\)/);
  assert.doesNotMatch(source,/body:JSON\.stringify\([^\n]*bookQuantity/);
});
