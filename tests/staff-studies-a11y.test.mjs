// /staff/studies (видача результатів + реєстр досліджень) — сторінка вже зріла
// за a11y (aria-label на фільтрах/селектах/пошуку, role="group"+aria-pressed на
// табах стану, role="alert"/status на повідомленнях, екрани доступу/мережі з
// «Повторити», per-row aria-label на селектах призначення, confirm на незворотній
// видачі). Залишкові прогалини:
//  • інпути/селекти мали focus-ring, а кнопки .studiesClear і таби .studiesTabs
//    button — ні (лише :hover), тож клавіатурний фокус був невидимий (WCAG 2.4.7);
//  • плейсхолдер завантаження реєстру не оголошувався (role="status").

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("studies: кнопки-фільтри й таби мають видимий клавіатурний фокус", async () => {
  const css = await read("app/styles/10-landing.css");
  assert.match(css, /\.studiesClear:focus-visible\{outline:2px solid var\(--ws-accent,#0c7a85\);outline-offset:2px\}/);
  assert.match(css, /\.studiesTabs button:focus-visible\{outline:2px solid var\(--ws-accent\);outline-offset:2px\}/);
});

test("studies: плейсхолдер завантаження реєстру оголошується як статус", async () => {
  const page = await read("app/staff/studies/page.tsx");
  assert.match(page, /<p className="dashLoading" role="status" aria-live="polite">Завантаження реєстру…<\/p>/);
});

test("studies: наявні a11y-патерни збережено (regression guard)", async () => {
  const page = await read("app/staff/studies/page.tsx");
  assert.match(page, /role="group" aria-label="Фільтр за станом"/);
  assert.match(page, /aria-pressed=\{filter==="all"\}/);
  assert.match(page, /aria-label=\{`Змінити стан для \$\{s\.code\}`\}/);
  // Незворотна видача результату лишається за підтвердженням.
  assert.match(page, /window\.confirm\("Видати результат пацієнту\?/);
});
