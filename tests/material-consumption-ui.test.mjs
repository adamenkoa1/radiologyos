import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const pageUrl=new URL("../app/staff/inventory/material-consumption/page.tsx",import.meta.url);

test("material consumption workspace uses the canonical queue and current warehouse balances",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/fetch\("\/api\/staff\/material-consumption",\{cache:"no-store"\}\)/);
  assert.match(source,/fetch\("\/api\/staff\/inventory",\{cache:"no-store"\}\)/);
  assert.match(source,/row\.warehouseId===selected\.warehouseId&&row\.itemId===selected\.itemId/);
  assert.match(source,/Number\(row\.stock\)>EPS/);
});

test("material consumption draft sends only reservation identity and explicit lot allocations",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/method:"POST"/);
  assert.match(source,/body:JSON\.stringify\(\{reservationId:selected\.reservationId,allocations:allocations\.map\(row=>\(\{lotId:row\.lotId,quantity:Number\(row\.quantity\)\}\)\)\}\)/);
  assert.doesNotMatch(source,/body:JSON\.stringify\(\{[^\n]*bookingId/);
  assert.doesNotMatch(source,/body:JSON\.stringify\(\{[^\n]*warehouseId/);
  assert.doesNotMatch(source,/body:JSON\.stringify\(\{[^\n]*itemId/);
});

test("material consumption workspace never auto-posts the inventory writeoff",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.doesNotMatch(source,/action:"post"/);
  assert.doesNotMatch(source,/\/api\/staff\/inventory\/documents/);
  assert.match(source,/Ця дія не проводить складський документ/);
  assert.match(source,/Створити чернетку списання/);
});

test("material consumption UI exposes planned, draft, posted and remaining quantities",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/row\.plannedQuantity/);
  assert.match(source,/row\.draftQuantity/);
  assert.match(source,/row\.postedQuantity/);
  assert.match(source,/row\.remainingQuantity/);
  assert.match(source,/statusLabel\(row\.status\)/);
});
