import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const pageUrl=new URL("../app/staff/inventory/transfers/page.tsx",import.meta.url);

test("inventory transfer workspace downloads only the canonical server PDF",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/fetch\("\/api\/staff\/inventory\/transfers\/print",\{/);
  assert.match(source,/body:JSON\.stringify\(\{documentId:selected\.document\.id\}\)/);
  assert.match(source,/const snapshotId=Number\(payload\.snapshot\?\.id\|\|0\)/);
  assert.match(source,/window\.location\.assign\(`\/api\/staff\/printed-forms\/pdf\?snapshotId=\$\{snapshotId\}`\)/);
  assert.match(source,/printing\?"Формування PDF…":"PDF"/);
  assert.doesNotMatch(source,/renderPrintedFormHtml|new Blob|createObjectURL|application\/pdf/);
});
