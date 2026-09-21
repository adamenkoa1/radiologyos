// Зрозумілість публічних сторінок для літніх/не-технічних пацієнтів:
// (А) помітна кнопка «зателефонувати в реєстратуру» у блоці запису;
// (Б) без жаргону «слот» — «оберіть зручний час», «триває приблизно»;
// (В) пом'якшене формулювання кабінету («можна просто подзвонити»).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const BOOKING_PAGES = ["public/site/index.html", "public/site/price.html", "public/site/military.html"];

test("A: booking block offers a prominent 'call the registry' link", async () => {
  for (const page of BOOKING_PAGES) {
    const html = await read(page);
    assert.match(html, /class="book-call-link" href="tel:\+380972808899"/, `${page}: кнопка дзвінка`);
    assert.match(html, /Просто зателефонуйте в реєстратуру/, `${page}: текст дзвінка`);
  }
  const css = await read("public/site/assets/site.css");
  assert.match(css, /\.book-call-link\{/, "site.css: стиль кнопки дзвінка");
});

test("B: no 'слот' jargon on patient-facing pages", async () => {
  for (const page of BOOKING_PAGES) {
    const html = await read(page);
    assert.doesNotMatch(html, /Оберіть слот/, `${page}: лишився жаргон «слот»`);
    assert.match(html, /Оберіть зручний час/, `${page}: людяне формулювання`);
  }
  const landing = await read("app/components/seo-service-landing.tsx");
  assert.doesNotMatch(landing, /Орієнтовний слот/);
  assert.match(landing, /Триває приблизно \{service\.durationMinutes\} хв/);
});

test("C: cabinet note is softened and still optional", async () => {
  for (const page of BOOKING_PAGES) {
    const html = await read(page);
    assert.match(html, /class="cabinet-note">Необов'язково/, `${page}: cabinet-note starts optional`);
    assert.match(html, /можна просто подзвонити/, `${page}: підказка про дзвінок`);
  }
});
