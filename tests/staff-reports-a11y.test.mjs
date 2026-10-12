// UI/UX-аудит /staff/reports (локальна a11y, без зміни логіки/API):
//  - селектор шаблону звіту отримав семантику вкладок (role=tablist/tab,
//    aria-selected), як на /staff/imaging і /staff/tasks;
//  - кастомні контроли (вкладки шаблону, дії з колонками, кнопки форми,
//    «Завантажити Excel») отримали видимий keyboard-фокус (WCAG 2.2 §2.4.7) —
//    раніше фокус мали лише поля вводу й лінки «Інші звіти»;
//  - таблиця прев'ю отримала доступну назву.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("report template selector exposes tab semantics", async () => {
  const page = await read("app/staff/reports/page.tsx");
  assert.match(page, /className="reportTemplateTabs" role="tablist" aria-label="Шаблон звіту"/);
  assert.match(page, /role="tab"\s*\n\s*aria-selected=\{template === item\.key\}/);
});

test("report preview table has an accessible name", async () => {
  const page = await read("app/staff/reports/page.tsx");
  assert.match(page, /<table className="financeTable" aria-label="Попередній перегляд звіту">/);
});

test("report hub custom controls have a visible keyboard focus ring", async () => {
  const css = await read("app/styles/24-reports-minimal.css");
  assert.match(css, /\.reportTemplateTabs button:focus-visible\{outline:2px solid var\(--rp-accent\)/);
  assert.match(css, /\.columnActions button:focus-visible\{outline:2px solid var\(--rp-accent\)/);
  assert.match(css, /\.reportFormActions button:focus-visible,[^\n]*\.excelButton:focus-visible\{outline:2px solid var\(--rp-accent\)/);
});
