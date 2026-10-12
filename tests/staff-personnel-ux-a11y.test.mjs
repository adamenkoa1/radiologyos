// UI/UX-аудит /staff/personnel (локальні покращення, без зміни логіки/API):
//  - редактор картки відкривається ПІД довгим реєстром → доводимо його у вьюпорт
//    (той самий scrollIntoView-патерн, що в supplier-payables);
//  - кнопки-дії в рядках отримали контекст рядка (aria-label з іменем/посадою),
//    бо «Картка»/«Змінити» без контексту неінформативні для скрінрідера;
//  - таблиці та колонки-дії отримали доступні назви.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("selecting/creating a personnel card scrolls the editor into view", async () => {
  const page = await read("app/staff/personnel/page.tsx");
  assert.match(page, /function scrollToEditor\(\) \{[\s\S]*?getElementById\("personnel-editor"\)\?\.scrollIntoView\(\{ behavior:"smooth", block:"start" \}\)/);
  assert.match(page, /function startCreate\(\)[\s\S]*?scrollToEditor\(\);/);
  assert.match(page, /function startEdit\(id:string\)[\s\S]*?scrollToEditor\(\);/);
  assert.match(page, /<section className="financeJournal" id="personnel-editor">/);
});

test("per-row action buttons carry row context for assistive tech", async () => {
  const page = await read("app/staff/personnel/page.tsx");
  assert.match(page, /aria-label=\{`Відкрити картку працівника: \$\{record\.displayName\}`\}/);
  assert.match(page, /aria-label=\{`Змінити призначення: \$\{row\.positionTitle\}`\}/);
  assert.match(page, /aria-label=\{`Змінити графік: \$\{row\.name\}`\}/);
});

test("data tables and their action columns have accessible names", async () => {
  const page = await read("app/staff/personnel/page.tsx");
  assert.match(page, /<table className="financeTable" aria-label="Реєстр персоналу">/);
  assert.match(page, /aria-label="Призначення працівника"/);
  assert.match(page, /aria-label="Графік роботи працівника"/);
  assert.match(page, /<th aria-label="Дії"\/>/);
});
