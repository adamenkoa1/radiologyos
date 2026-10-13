// /staff/cash-accounts — BAS-довідник кас і банківських рахунків (master-
// detail). Зрілий: useSubmit-резилієнс, best-effort reload, financeError
// role=alert, notice з role/aria-live, canEdit read-only, незмінна ідентичність
// (тип+валюта блокуються після створення — classificationLocked), isDefault
// підтягує active. Закрито a11y-прогалини, вирівняні з рештою BAS:
// financeLoading role=status, aria-label пошуку, aria-label порожньої колонки-дії.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/staff/cash-accounts/page.tsx", import.meta.url), "utf8");

test("cash-accounts: loading announced, search labelled, action column named", () => {
  assert.match(page, /className="financeLoading" role="status" aria-live="polite"/);
  assert.match(page, /<input type="search" aria-label="Пошук кас і рахунків за назвою, кодом або валютою"/);
  assert.match(page, /<th>Основний<\/th><th>Стан<\/th><th aria-label="Дії"\/>/);
});

test("cash-accounts: classification identity lock preserved (regression guard)", () => {
  // Тип і валюта мають лишатися незмінними після створення запису.
  assert.match(page, /const classificationLocked=!!form\.id;/);
  assert.match(page, /disabled=\{!data\.canEdit\|\|classificationLocked\}/);
});
