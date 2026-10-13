// /staff/counterparties — BAS-довідник (master-detail). Зрілий: useSubmit-
// резилієнс, best-effort reload, financeError role=alert, notice з
// role/aria-live, canManage read-only, implicit-label форми. Закрито a11y-
// прогалини, вирівняні з рештою BAS: financeLoading role=status, aria-label
// пошуку, aria-label порожньої колонки-дії.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/staff/counterparties/page.tsx", import.meta.url), "utf8");

test("counterparties: loading announced, search labelled, action column named", () => {
  assert.match(page, /className="financeLoading" role="status" aria-live="polite"/);
  assert.match(page, /<input type="search" aria-label="Пошук контрагентів за назвою, кодом або ЄДРПОУ"/);
  assert.match(page, /<th>Стан<\/th><th aria-label="Дії"\/>/);
});
