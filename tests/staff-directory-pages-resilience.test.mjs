// Довідники складу й обладнання мають переживати мережевий збій збереження
// (показати помилку, а не мовчазний no-op) і озвучувати статуси скрінрідером.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("saving a warehouse is guarded by the shared useSubmit hook", async () => {
  const page = await read("app/staff/warehouses/page.tsx");
  // resilience comes from the shared hook, not a hand-written try/catch per page
  assert.match(page, /import \{ useSubmit \} from "\.\.\/\.\.\/hooks\/use-submit"/);
  assert.match(page, /useSubmit\(\(\)=>setNotice\("⚠ Не вдалося зберегти/);
  assert.match(page, /async function save[\s\S]*?await run\(async\(\)=>\{/);
  // reload after a successful save is best-effort, so it cannot masquerade as a save failure
  assert.match(page, /await load\(\)\.catch\(\(\)=>\{\}\);/);
  assert.doesNotMatch(page, /setBusy\(/);
  // status/error still carry screen-reader roles
  assert.match(page, /className="financeError" role="alert">\{error\}/);
  assert.match(page, /role=\{notice\.startsWith\("⚠"\)\?"alert":"status"\}/);
});

test("saving the equipment registry guards against double-submit and a network throw", async () => {
  const page = await read("app/staff/equipment/page.tsx");
  // re-entry guard + saving state around the PUT
  assert.match(page, /if\(saving\)return;/);
  assert.match(page, /setSaving\(true\);/);
  assert.match(page, /async function save[\s\S]*?catch\{[\s\S]*?setError\("Не вдалося зберегти/);
  assert.match(page, /finally\{setSaving\(false\);\}/);
  // the submit button reflects the in-flight state
  assert.match(page, /type="submit" disabled=\{saving\}/);
  assert.match(page, /saving\?"Збереження…"/);
  // status/error carry screen-reader roles
  assert.match(page, /className="notice success" role="status" aria-live="polite">\{notice\}/);
  assert.match(page, /className="notice error" role="alert">\{error\}/);
});
