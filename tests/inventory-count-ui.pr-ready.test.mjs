import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE_URL=new URL("../app/staff/inventory/counts/page.tsx",import.meta.url);

test("inventory count workspace renders create and post actions",async()=>{
  const source=await readFile(PAGE_URL,"utf8");
  assert.match(source,/Створити чернетку/);
  assert.match(source,/Провести коригування/);
});
