// /staff/warehouses — BAS-довідник складів (місць зберігання), master-detail.
// Зрілий: useSubmit-резилієнс, best-effort reload, financeError role=alert,
// notice з role/aria-live, canEdit read-only, isDefault підтягує active,
// проведені документи зберігають власний історичний snapshot. Закрито a11y-
// прогалини, вирівняні з рештою BAS: financeLoading role=status, aria-label
// пошуку, aria-label порожньої колонки-дії.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/staff/warehouses/page.tsx", import.meta.url), "utf8");

test("warehouses: loading announced, search labelled, action column named", () => {
  assert.match(page, /className="financeLoading" role="status" aria-live="polite"/);
  assert.match(page, /<input type="search" aria-label="Пошук складів за назвою або кодом"/);
  assert.match(page, /<th>Основний<\/th><th>Стан<\/th><th aria-label="Дії"\/>/);
});

test("warehouses: default toggle forces active, read-only gating preserved (regression guard)", () => {
  // Встановлення основного складу має автоматично робити його активним.
  assert.match(page, /isDefault:e\.target\.checked,active:e\.target\.checked\?true:form\.active/);
  // Форма редагується лише за canEdit.
  assert.match(page, /if\(!data\?\.canEdit\)return;/);
});
