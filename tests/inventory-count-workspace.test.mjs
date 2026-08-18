import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {bookQuantityForBucket,discrepancy,initialCountSheet,normalizeCountSheet} from "../lib/inventory-count-workspace.ts";

const balances=[{warehouseId:10,lotId:1,stock:5},{warehouseId:10,lotId:2,stock:0},{warehouseId:20,lotId:1,stock:9}];
const lots=[{id:1,itemId:100,itemName:"Контраст",lotNumber:"A",stock:14},{id:2,itemId:200,itemName:"Шприц",lotNumber:"B",stock:0}];

test("count workspace snapshots only visible positive buckets and keeps zero valid",()=>{
  assert.equal(bookQuantityForBucket(balances,10,1),5);
  assert.equal(bookQuantityForBucket(balances,10,2),0);
  assert.deepEqual(initialCountSheet(10,lots,balances),[{warehouseId:10,lotId:1,countedQuantity:5}]);
  assert.deepEqual(normalizeCountSheet([{warehouseId:10,lotId:2,countedQuantity:0}]),[{warehouseId:10,lotId:2,countedQuantity:0}]);
  assert.equal(discrepancy(5,3),-2);assert.equal(discrepancy(5,8),3);assert.equal(discrepancy(5,5),0);
});

test("count workspace rejects forged/duplicate bucket shapes before request",()=>{
  assert.throws(()=>normalizeCountSheet([{warehouseId:0,lotId:1,countedQuantity:1}]),/warehouse_required/);
  assert.throws(()=>normalizeCountSheet([{warehouseId:10,lotId:0,countedQuantity:1}]),/lot_required/);
  assert.throws(()=>normalizeCountSheet([{warehouseId:10,lotId:1,countedQuantity:-1}]),/invalid_quantity/);
  assert.throws(()=>normalizeCountSheet([{warehouseId:10,lotId:1,countedQuantity:1},{warehouseId:10,lotId:1,countedQuantity:2}]),/duplicate_bucket/);
});

test("workspace uses registrar API and never submits client book quantity",async()=>{
  const source=await readFile(new URL("../app/staff/inventory/counts/page.tsx",import.meta.url),"utf8");
  assert.match(source,/\/api\/staff\/inventory\/counts/);
  assert.match(source,/action:\"create\",comment,lines/);
  assert.match(source,/normalizeCountSheet\(sheet\)/);
  const helper=await readFile(new URL("../lib/inventory-count-workspace.ts",import.meta.url),"utf8");
  assert.match(helper,/return\{warehouseId,lotId,countedQuantity\}/);
  assert.doesNotMatch(helper,/bookQuantity:[^F]/);
});
