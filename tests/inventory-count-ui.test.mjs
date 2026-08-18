import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE_URL=new URL("../app/staff/inventory/counts/page.tsx",import.meta.url);

test("inventory count workspace uses canonical inventory and count APIs",async()=>{
  const source=await readFile(PAGE_URL,"utf8");
  assert.match(source,/fetch\("\/api\/staff\/inventory",\{cache:"no-store"\}\)/);
  assert.match(source,/fetch\("\/api\/staff\/inventory\/counts",\{cache:"no-store"\}\)/);
  assert.match(source,/\/api\/staff\/inventory\/counts\?id=\$\{id\}/);
  assert.match(source,/action:"create"/);
  assert.match(source,/action:kind,documentId:selected\.document\.id/);
});

test("inventory count draft sends only physical observations, not trusted book balances",async()=>{
  const source=await readFile(PAGE_URL,"utf8");
  assert.match(source,/lines:normalized\.map\(line=>\(\{warehouseId:line\.warehouseId,lotId:line\.lotId,countedQuantity:line\.countedQuantity,reason:line\.reason\}\)\)/);
  assert.doesNotMatch(source,/body:JSON\.stringify\([^\n]*bookQuantity/);
  assert.match(source,/countedQuantity<0/);
  assert.match(source,/lines\.length>=200/);
});

test("inventory count workspace keeps stale-balance semantics visible to operators",async()=>{
  const source=await readFile(PAGE_URL,"utf8");
  assert.match(source,/D1 повторно перевіряє баланс/);
  assert.match(source,/проведення блокується як застаріле/);
  assert.match(source,/Провести коригування/);
});
