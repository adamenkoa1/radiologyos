// /staff/imaging (DICOM/PACS-прив'язка) — зрілий модуль (useSubmit-резилієнс,
// catch у load/openBooking, екрани доступу/мережі з «Повторити», role=alert/status,
// readonly fieldset, countUk з lib/labels). Усунено неузгодженість із /staff/protocols,
// що ділить класи protocolFilterTabs/protocolQueueItem: imaging використовував
// неповний tablist (role=tab/aria-selected без tabpanel/roving/arrows), тоді як
// protocols — role=group+aria-pressed. Приведено до спільної конвенції + aria-label
// пошуку + aria-current вибраного елемента.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("imaging filter tabs use the shared group+aria-pressed convention (not an incomplete tablist)", () => {
  const page = read("app/staff/imaging/page.tsx");
  assert.match(page, /className="protocolFilterTabs" role="group" aria-label="Фільтр робочого списку"/);
  assert.match(page, /aria-pressed=\{filter==="all"\}/);
  assert.doesNotMatch(page, /protocolFilterTabs" role="tablist"/);
  assert.doesNotMatch(page, /role="tab" aria-selected=\{filter/);
});

test("imaging search has an accessible name and selected item exposes aria-current", () => {
  const page = read("app/staff/imaging/page.tsx");
  assert.match(page, /<input type="search" aria-label="Пошук у робочому списку за кодом, ПІБ або Accession"/);
  assert.match(page, /aria-current=\{selectedId===item\.id \? "true" : undefined\}/);
});
