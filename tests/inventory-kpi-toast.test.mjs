// Склад (/staff/inventory): тост складських операцій зникає сам за ~4с (клік —
// одразу), а KPI «нижче мінімуму» не рахує порожні позиції з minStock=0 (їх
// показує окремий лічильник «немає залишку»).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = () => readFile(new URL("../app/staff/inventory/page.tsx", import.meta.url), "utf8");

test("stock toast auto-dismisses and stays click-dismissible", async () => {
  const page = await read();
  assert.match(page, /if\(!toast\) return;.*setTimeout\(\(\)=>setToast\(""\),4000\)/s);
  assert.match(page, /onClick=\{\(\)=>setToast\(""\)\}/);
});

test("low-stock KPI excludes empty items without a defined minimum", async () => {
  const page = await read();
  // KPI count.
  assert.match(page, /i\.minStock > 0 && i\.stock > 0 && i\.stock <= i\.minStock/);
  // Row-level low flag aligned with the KPI definition.
  assert.match(page, /const low=i\.minStock>0&&i\.stock>0&&i\.stock<=i\.minStock/);
  // The old naive definition is gone.
  assert.doesNotMatch(page, /low:all\.filter\(i=>i\.stock <= i\.minStock\)/);
});
