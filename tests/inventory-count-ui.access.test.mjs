import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";

const PAGE_URL=new URL("../app/staff/inventory/counts/page.tsx",import.meta.url);

test("inventory count workspace route exists",async()=>{
  await assert.doesNotReject(()=>access(PAGE_URL));
});
