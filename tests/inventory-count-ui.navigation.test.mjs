import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const SHELL_URL=new URL("../app/staff/workspace-shell.tsx",import.meta.url);

test("inventory module links to the inventory count workspace",async()=>{
  const source=await readFile(SHELL_URL,"utf8");
  assert.match(source,/label:\"Інвентаризація\",href:\"\/staff\/inventory\/counts\"/);
  assert.match(source,/Фактичні залишки та контрольовані коригування/);
});
