// Сторінка кредиторки постачальників має переживати мережевий збій операції
// (оцінка/оплата/проведення/скасування): показати помилку, а не мовчазний
// no-op, і озвучувати статуси скрінрідером.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("the shared action helper surfaces a network throw instead of failing silently", async () => {
  const page = await read("app/staff/supplier-payables/page.tsx");
  // the POST is wrapped so a thrown network error reaches the user as an error toast
  assert.match(page, /async function action\([\s\S]*?catch\{[\s\S]*?setToast\("⚠ Не вдалося виконати операцію/);
  // busy is always reset
  assert.match(page, /\}finally\{setBusy\(false\);\}\}/);
  // the post-op reload is best-effort, so it cannot masquerade as an operation failure
  assert.match(page, /await load\(\)\.catch\(\(\)=>\{\}\);/);
});

test("the operation toast announces errors assertively and successes politely", async () => {
  const page = await read("app/staff/supplier-payables/page.tsx");
  assert.match(page, /role=\{toast\.startsWith\("⚠"\)\?"alert":"status"\}/);
  assert.match(page, /aria-live=\{toast\.startsWith\("⚠"\)\?"assertive":"polite"\}/);
  assert.match(page, /className="financeError" role="alert">\{error\}/);
});
