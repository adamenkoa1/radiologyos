import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE_URL=new URL("../app/staff/inventory/counts/page.tsx",import.meta.url);

test("inventory count mutation controls respect server canManage",async()=>{
  const source=await readFile(PAGE_URL,"utf8");
  assert.match(source,/inventory\.canManage&&<button className=\"primary\"/);
  assert.match(source,/inventory\.canManage&&selected\.document\.state===?\"draft\"/);
});
