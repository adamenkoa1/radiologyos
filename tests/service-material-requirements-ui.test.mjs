import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const pageUrl=new URL("../app/staff/services/page.tsx",import.meta.url);

test("services workspace loads canonical material requirements and inventory references",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/fetch\("\/api\/staff\/service-material-requirements",\{cache:"no-store"\}\)/);
  assert.match(source,/fetch\("\/api\/staff\/inventory",\{cache:"no-store"\}\)/);
  assert.match(source,/setMaterialCanEdit\(Boolean\(requirementData\.canEdit\)\)/);
});

test("new material requirement sends only configuration identity and quantity",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/method:"POST"/);
  assert.match(source,/body:JSON\.stringify\(\{serviceCode:materialForm\.serviceCode,itemId,warehouseId,quantity\}\)/);
  assert.doesNotMatch(source,/reservationId:.*materialForm/);
  assert.doesNotMatch(source,/bookingId:.*materialForm/);
});

test("existing requirements are deactivated by exact id instead of rewritten",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/method:"PATCH"/);
  assert.match(source,/body:JSON\.stringify\(\{id:row\.id\}\)/);
  assert.doesNotMatch(source,/method:"DELETE"/);
  assert.match(source,/Історичні резервації та рухи залишаються незмінними/);
});

test("material requirement editing is gated by server canEdit and stays separate from physical consumption",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/materialCanEdit&&<form/);
  assert.match(source,/materialCanEdit&&row\.active/);
  assert.match(source,/Норма створює лише планову резервацію/);
  assert.match(source,/Фактичне списання виконується окремо/);
  assert.doesNotMatch(source,/fetch\("\/api\/staff\/material-consumption",\{method:/);
});
