import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const PAGE=new URL("../app/staff/inventory/counts/page.tsx",import.meta.url);

test("inventory count workspace requests a server snapshot before downloading PDF",async()=>{
  const source=await readFile(PAGE,"utf8");
  assert.match(source,/fetch\("\/api\/staff\/inventory\/counts\/print"/);
  assert.match(source,/body:JSON\.stringify\(\{documentId:selected\.document\.id\}\)/);
  assert.match(source,/snapshotId=Number\(payload\.snapshot\?\.id\|\|0\)/);
  assert.match(source,/window\.location\.assign\(`\/api\/staff\/printed-forms\/pdf\?snapshotId=\$\{snapshotId\}`\)/);
});

test("PDF download is not gated by inventory mutation permission",async()=>{
  const source=await readFile(PAGE,"utf8");
  assert.match(source,/<button disabled=\{printing\} type="button" onClick=\{\(\)=>void downloadPdf\(\)\}>/);
  assert.doesNotMatch(source,/inventory\.canManage&&<button disabled=\{printing\}/);
  assert.match(source,/inventory\.canManage&&selected\.document\.state==="draft"/);
});

test("inventory count PDF is always server-generated, never client-rendered",async()=>{
  const source=await readFile(PAGE,"utf8");
  assert.doesNotMatch(source,/window\.print\(/);
  assert.doesNotMatch(source,/Blob\(|URL\.createObjectURL|application\/pdf/);
  assert.match(source,/Не вдалося сформувати PDF/);
});
