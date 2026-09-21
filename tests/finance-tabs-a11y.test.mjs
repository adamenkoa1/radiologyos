// Фінансовий журнал (/staff/finance): вкладки — коректний ARIA tablist
// (role=tab/aria-selected/aria-controls, roving tabindex, tabpanel), а навігація
// в пов'язані розділи — справжні <a href>, а не role=tab + location.assign.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = () => readFile(new URL("../app/staff/finance/page.tsx", import.meta.url), "utf8");

test("finance tabs use a correct ARIA tablist", async () => {
  const page = await read();
  assert.match(page, /role="tablist"/);
  assert.match(page, /role="tab"/);
  assert.match(page, /aria-selected=\{tab===item\.id\}/);
  assert.match(page, /aria-controls=\{`fin-panel-\$\{item\.id\}`\}/);
  assert.match(page, /tabIndex=\{tab===item\.id\?0:-1\}/);
  // Roving focus / keyboard navigation across the tabs.
  assert.match(page, /onKeyDown=\{onTabKeyDown\}/);
  assert.match(page, /event\.key==="ArrowRight"/);
});

test("each finance panel is a labelled tabpanel", async () => {
  const page = await read();
  for (const id of ["documents", "cash", "settlements"]) {
    assert.match(page, new RegExp(`role="tabpanel" id="fin-panel-${id}" aria-labelledby="fin-tab-${id}"`));
  }
});

test("related sections are real links, not tabs or location.assign", async () => {
  const page = await read();
  assert.doesNotMatch(page, /window\.location\.assign/);
  assert.match(page, /<nav className="financeRelated" aria-label="Пов'язані розділи">/);
  assert.match(page, /href=\{link\.href\}/);
  // The four related destinations remain reachable.
  for (const href of ["/staff/cash-accounts", "/staff/finance/services", "/staff/documents", "/staff/reports/registers"]) {
    assert.match(page, new RegExp(`href:"${href.replace(/\//g, "\\/")}"`), `посилання на ${href}`);
  }
});
