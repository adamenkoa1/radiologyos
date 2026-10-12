// financeToolbar: заголовок секції тепер семантичний <h2>, а не неозначений
// <b>. Перехід системний — по всіх BAS-сторінках (кожна <section
// className="financeJournal"> має один <header className="financeToolbar">, а
// його перший <div> — це заголовок секції). Візуально нічого не змінюється:
// density-шар застосовує ті самі розміри до :is(b,h2) і скидає блокові/
// заголовкові дефолти h2 назад до інлайнового ритму старого <b>.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const STAFF = "app/staff";
const pages = readdirSync(STAFF, { recursive: true })
  .filter((p) => String(p).endsWith("page.tsx"))
  .map((p) => `${STAFF}/${p}`);

// Перший <div> одразу після відкриття financeToolbar — це заголовок секції.
const titleB = /<header className="financeToolbar">\s*<div><b>/g;
const titleH2 = /<header className="financeToolbar">\s*<div><h2>[\s\S]*?<\/h2>/g;

test("жоден заголовок секції financeToolbar не лишився неозначеним <b>", () => {
  assert.ok(pages.length > 10, "staff-сторінки знайдено");
  const offenders = [];
  for (const file of pages) {
    const src = readFileSync(file, "utf8");
    if (titleB.test(src)) offenders.push(file);
    titleB.lastIndex = 0;
  }
  assert.deepEqual(offenders, [], "заголовки секцій мають бути <h2>, не <b>");
});

test("заголовки секцій financeToolbar системно переведені на <h2>", () => {
  let total = 0;
  for (const file of pages) {
    const src = readFileSync(file, "utf8");
    total += (src.match(titleH2) || []).length;
    titleH2.lastIndex = 0;
  }
  // Станом на перехід — 53 секційних заголовки по всіх BAS-сторінках.
  assert.ok(total >= 50, `очікували ≥50 секційних <h2>, знайдено ${total}`);
});

test("density-шар рендерить <h2>-заголовок ідентично старому інлайновому <b>", () => {
  const density = readFileSync("app/styles/23-bas-enterprise-density.css", "utf8");
  // Той самий розмір для b і h2 (базовий і в pointer:coarse).
  assert.match(density, /\.basWorkspaceShell \.financeToolbar :is\(b,h2\)\{font-size:10\.5px\}/);
  assert.match(density, /\.basWorkspaceShell \.financeToolbar :is\(b,h2\),\.basWorkspaceShell \.staffTools b\{font-size:13px\}/);
  // Скидання блокових/заголовкових дефолтів h2 до інлайнового ритму <b>.
  assert.match(density, /\.basWorkspaceShell \.financeToolbar h2\{display:inline;margin:0;font-weight:700;line-height:inherit\}/);
});
