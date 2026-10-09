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

test("saving service assignments is guarded by the shared useSubmit hook",async()=>{
  const source=await readFile(pageUrl,"utf8");
  // resilience (double-submit guard + catch + reset) comes from the shared hook
  assert.match(source,/import \{ useSubmit \} from "\.\.\/\.\.\/hooks\/use-submit"/);
  assert.match(source,/const \{ busy: saving, run \} = useSubmit\(\(\) => setError\([^)]*Не вдалося зберегти/);
  // the PUT runs inside run(), which guards re-entry and resets busy
  assert.match(source,/async function save[\s\S]*?await run\(async \(\) => \{/);
  // the submit button still reflects the in-flight state (busy aliased as saving)
  assert.match(source,/type="submit" disabled=\{saving\}/);
  assert.match(source,/saving \? "Збереження…"/);
  // the hand-rolled saving state is gone
  assert.doesNotMatch(source,/setSaving\(/);
});

test("service page status and error messages carry screen-reader roles",async()=>{
  const source=await readFile(pageUrl,"utf8");
  assert.match(source,/className="notice error" role="alert">\{error\}/);
  assert.match(source,/className="notice success" role="status" aria-live="polite">\{notice\}/);
  assert.match(source,/className="notice error" role="alert">\{materialError\}/);
  assert.match(source,/className="notice success" role="status" aria-live="polite">\{materialNotice\}/);
});
