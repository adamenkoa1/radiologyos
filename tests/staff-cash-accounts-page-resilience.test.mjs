// Довідник кас і рахунків має переживати мережевий збій збереження (показати
// помилку, а не мовчазний no-op) і озвучувати статуси скрінрідером.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("saving a cash account surfaces a network throw instead of failing silently", async () => {
  const page = await read("app/staff/cash-accounts/page.tsx");
  // the save handler wraps its fetch so a thrown network error reaches the user
  assert.match(page, /async function save[\s\S]*?catch\{[\s\S]*?setNotice\("⚠ Не вдалося зберегти/);
  // busy is always reset
  assert.match(page, /\}finally\{setBusy\(false\);\}\}/);
  // reload after a successful save is best-effort, so it cannot masquerade as a save failure
  assert.match(page, /await load\(\)\.catch\(\(\)=>\{\}\);/);
});

test("cash account status and error messages carry screen-reader roles", async () => {
  const page = await read("app/staff/cash-accounts/page.tsx");
  assert.match(page, /className="financeError" role="alert">\{error\}/);
  // the single notice element toggles role/aria-live by its ⚠ prefix
  assert.match(page, /role=\{notice\.startsWith\("⚠"\)\?"alert":"status"\}/);
  assert.match(page, /aria-live=\{notice\.startsWith\("⚠"\)\?"assertive":"polite"\}/);
});
