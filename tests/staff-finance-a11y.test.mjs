// /staff/finance — вже модельна сторінка за доступністю (повний ARIA-tabs
// патерн з arrow-key навігацією, focus-ring на вкладках/лінках/кнопках тулбара,
// безпечний json-parse, екран доступу). Єдиний локальний нюанс: порожня
// колонка-дії в таблиці документів не мала доступної назви — вирівняно з
// конвенцією /staff/personnel.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("finance documents action column has an accessible name", async () => {
  const page = await read("app/staff/finance/page.tsx");
  assert.match(page, /<th className="num">Сума<\/th><th>Стан<\/th><th aria-label="Дії"\/>/);
});

test("finance keeps its accessible tabs pattern (regression guard)", async () => {
  const page = await read("app/staff/finance/page.tsx");
  // роль tablist + roving tabindex + arrow-key навігація — не загубити
  assert.match(page, /role="tablist"/);
  assert.match(page, /role="tab" id=\{`fin-tab-\$\{item\.id\}`\} aria-selected=\{tab===item\.id\}/);
  assert.match(page, /function onTabKeyDown/);
  assert.match(page, /role="tabpanel"/);
});
