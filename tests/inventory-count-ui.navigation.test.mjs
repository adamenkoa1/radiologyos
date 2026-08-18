import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const SHELL_URL=new URL("../app/staff/workspace-shell.tsx",import.meta.url);

test.skip("inventory module links to the inventory count workspace until menu wiring lands",async()=>{
  const source=await readFile(SHELL_URL,"utf8");
  assert.match(source,/href:\"\/staff\/inventory\/counts\"/);
});
