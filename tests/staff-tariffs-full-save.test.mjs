// Регрес: редагування одного тарифу не має стирати перевизначення інших.
//
// Серверний PUT /api/staff/tariffs ПОВНІСТЮ замінює blob перевизначень на
// sanitizePriceOverrides(prices) — тобто клієнт мусить надсилати ефективну ціну
// КОЖНОГО тарифу. Раніше save() будував prices лише з edits (змінених цієї
// сесії), тож збереження однієї позиції скидало всі інші кастомні ціни до
// типових. save() має ітерувати повний список tariffs, а не Object.entries(edits).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("tariffs save() sends the full price set, not just this session's edits", async () => {
  const page = await read("app/staff/tariffs/page.tsx");
  // будуємо prices з повного списку тарифів…
  assert.match(page, /const prices: Record<string, number> = \{\};\s*for \(const t of tariffs\)/);
  // …незаймане поле зберігає поточну ефективну ціну (наявне перевизначення)…
  assert.match(page, /if \(raw === undefined\) \{ prices\[t\.code\] = t\.price;/);
  // …порожнє поле повертає до типової (сервер відкине рівні типовій)…
  assert.match(page, /if \(raw\.trim\(\) === ""\) \{ prices\[t\.code\] = t\.defaultPrice;/);
  // старий баг: будування prices лише з edits прибрано
  assert.doesNotMatch(page, /for \(const \[code, raw\] of Object\.entries\(edits\)\)/);
});

// Серверний контракт, на який спирається фікс: повна заміна + відкидання
// значень, рівних типовій ціні (саме так працює скидання до типової).
test("tariffs PUT replaces the overrides blob and drops default-equal prices", async () => {
  const route = await read("app/api/staff/tariffs/route.ts");
  assert.match(route, /const overrides = sanitizePriceOverrides\(prices\);\s*await setSetting\(db, tariffOverridesKey/);
  const lib = await read("lib/tariffs.ts");
  assert.match(lib, /value !== service\.price/);
});
