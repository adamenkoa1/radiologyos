// Deep-link послуги: картка «Обрати час» на лендінгу веде на price.html?add=<код>,
// а price.html (cart.js) авто-додає саме цю послугу в кошик — пацієнт не шукає її
// вручну в загальному прайсі.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("service card CTA deep-links to the price page with the service code", async () => {
  const landing = await read("app/components/seo-service-landing.tsx");
  assert.match(landing, /href=\{`\/site\/price\.html\?add=\$\{service\.code\}`\}/);
});

test("cart auto-adds the service named in ?add= and opens the cart", async () => {
  const cart = await read("public/site/assets/cart.js");
  assert.match(cart, /new URLSearchParams\(location\.search\)\.get\('add'\)/);
  assert.match(cart, /querySelectorAll\('button\.row-add'\)/);
  assert.match(cart, /addToCart\('" \+ code \+ "'/);
  assert.match(cart, /target\.click\(\)/);
});
