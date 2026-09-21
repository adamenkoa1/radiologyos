// Склад (/staff/inventory): вкладки — коректний ARIA tablist
// (role=tab/aria-selected/aria-controls, roving tabindex, tabpanel); пов'язані
// розділи — справжні <a href>, а не role=tab + location.assign; перехід із руху
// в переміщення веде на конкретний документ (?id=).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = () => readFile(new URL("../app/staff/inventory/page.tsx", import.meta.url), "utf8");

test("inventory tabs use a correct ARIA tablist", async () => {
  const page = await read();
  assert.match(page, /role="tablist" aria-label="Розділи складу"/);
  assert.match(page, /role="tab"/);
  assert.match(page, /aria-selected=\{mode===item\.id\}/);
  assert.match(page, /aria-controls=\{`inv-panel-\$\{item\.id\}`\}/);
  assert.match(page, /tabIndex=\{mode===item\.id\?0:-1\}/);
  assert.match(page, /onKeyDown=\{onTabKeyDown\}/);
  assert.match(page, /event\.key==="ArrowRight"/);
});

test("each inventory mode is a labelled tabpanel", async () => {
  const page = await read();
  for (const id of ["stock", "documents", "movements"]) {
    assert.match(page, new RegExp(`role="tabpanel" id="inv-panel-${id}" aria-labelledby="inv-tab-${id}"`));
  }
});

test("related sections and shortcuts are real links, not location.assign", async () => {
  const page = await read();
  assert.match(page, /<nav className="inventoryRelated" aria-label="Пов'язані розділи">/);
  assert.match(page, /href=\{link\.href\}/);
  for (const href of ["/staff/inventory/counts", "/staff/warehouses"]) {
    assert.match(page, new RegExp(`href:"${href.replace(/\//g, "\\/")}"`), `посилання на ${href}`);
  }
  // Контрагенти — тепер <a>, а не кнопка з location.assign.
  assert.match(page, /<a className="inventorySmallBtn" href="\/staff\/counterparties">/);
  assert.doesNotMatch(page, /window\.location\.assign\("\/staff\/counterparties"\)/);
});

test("a transfer movement deep-links to its own transfer document", async () => {
  const page = await read();
  assert.match(page, /\/staff\/inventory\/transfers\?id=\$\{movement\.documentId\}/);
  assert.doesNotMatch(page, /window\.location\.assign\("\/staff\/inventory\/transfers"\)/);
});
