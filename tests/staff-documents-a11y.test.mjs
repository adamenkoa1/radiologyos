// /staff/documents (єдиний BAS-журнал) — успадковує модельний патерн (екран
// доступу, безпечний json-parse, openDocument з catch→setError). Локальні
// a11y-прогалини, вирівняні з рештою BAS-довідників:
//  • error/loading без role="alert"/role="status" (решта фінансових сторінок їх мають);
//  • порожні колонки-дії (<th/>) без доступної назви у двох таблицях;
//  • кнопка «Структура» перемикає деталі, але не повідомляла стан (aria-pressed),
//    а її клас .active не був стилізований — вибір був невидимий.
// Систематично: table-action-кнопки (.financeTable td>button) не мали focus-ring
// (його мали лише тулбар/вкладки/лінки) — це keyboard-прогалина WCAG 2.4.7 на
// всіх BAS-журналах, тож закрито на спільному рівні у 20-finance.css.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/staff/documents/page.tsx", "utf8");
const finance = readFileSync("app/styles/20-finance.css", "utf8");

test("documents: error та loading оголошуються асистивними технологіями", () => {
  assert.match(page, /className="financeError" role="alert"/);
  assert.match(page, /className="financeLoading" role="status" aria-live="polite"/);
});

test("documents: обидві колонки-дії мають доступну назву", () => {
  // Головна таблиця журналу + таблиця зв'язків у ланцюжку документа.
  const matches = page.match(/<th aria-label="Дії"\/>/g) || [];
  assert.equal(matches.length, 2, 'очікували 2 <th aria-label="Дії"/>');
});

test("documents: кнопка «Структура» повідомляє стан вибору (aria-pressed)", () => {
  assert.match(page, /<button type="button" aria-pressed=\{selectedId===row\.id\} className=\{selectedId===row\.id\?"active":""\}/);
});

test("documents: секція деталей позначає асинхронне завантаження (aria-busy)", () => {
  assert.match(page, /<section className="financeJournal" aria-busy=\{loadingDetail\}>/);
});

test("спільний рівень: table-action-кнопки отримали focus-ring і видимий стан .active", () => {
  // focus-visible додано до наявної групи фокус-рингів (не нова per-page дія).
  assert.match(finance, /\.financeTable td>button:focus-visible\{outline:2px solid var\(--ws-accent\);outline-offset:2px\}/);
  // Видимий стан вибраної кнопки дзеркалить наявний патерн .financeTabs button.active.
  assert.match(finance, /\.financeTable td>button\.active\{background:var\(--ws-accent\);color:white;border-color:var\(--ws-accent\)\}/);
});
