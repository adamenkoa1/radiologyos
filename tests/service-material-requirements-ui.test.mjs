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

test("saving service assignments guards against double-submit and a network throw",async()=>{
  const source=await readFile(pageUrl,"utf8");
  // re-entry guard while a PUT is in flight
  assert.match(source,/if \(saving\) return;/);
  assert.match(source,/setSaving\(true\);/);
  // the PUT is wrapped so a network throw surfaces an error instead of a silent no-op
  assert.match(source,/async function save[\s\S]*?catch \{[\s\S]*?setError\([^)]*Не вдалося зберегти/);
  assert.match(source,/finally \{\s*setSaving\(false\);/);
  // the submit button reflects the in-flight state and cannot be re-clicked
  assert.match(source,/type="submit" disabled=\{saving\}/);
  assert.match(source,/saving \? "Збереження…"/);
});

test("service page status and error messages carry screen-reader roles",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/className="notice error" role="alert">\{error\}/);
  assert.match(source,/className="notice success" role="status" aria-live="polite">\{notice\}/);
  assert.match(source,/className="notice error" role="alert">\{materialError\}/);
  assert.match(source,/className="notice success" role="status" aria-live="polite">\{materialNotice\}/);
});
