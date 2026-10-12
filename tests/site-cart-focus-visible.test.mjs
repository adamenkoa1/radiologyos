// Публічні cart-контроли («Моя заявка», закриття кошика, кнопка кошика на
// прайсі) мали стилі всюди, окрім видимого фокуса з клавіатури — решта
// інтерактивних елементів сторінки вже мають gold-ring (WCAG 2.2 §2.4.7).
// Це головний конверсійний елемент, тож keyboard-фокус має бути видимим.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("homepage cart controls have a visible keyboard focus ring", async () => {
  const html = await read("public/site/index.html");
  assert.match(html, /\.floating-cart:focus-visible\{outline:3px solid var\(--gold\);outline-offset:3px\}/);
  assert.match(html, /\.cart-close:focus-visible\{outline:3px solid var\(--gold\);outline-offset:2px\}/);
});

test("price page cart controls have a visible keyboard focus ring", async () => {
  const html = await read("public/site/price.html");
  assert.match(html, /\.floating-cart:focus-visible,\.cart-button:focus-visible\{outline:3px solid var\(--gold\);outline-offset:3px\}/);
  assert.match(html, /\.cart-close:focus-visible\{outline:3px solid var\(--gold\);outline-offset:2px\}/);
});
