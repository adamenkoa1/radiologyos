// Інлайн-валідація форми запису на клієнті має дзеркалити серверні правила
// й показувати помилку поля на blur, а не лише після сабміту.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("клієнтський валідатор ПІБ дзеркалить серверний NAME_TOKEN (анти-дрейф)", async () => {
  const server = await read("lib/patient-name.ts");
  const bridge = await read("public/site/assets/d1-bridge.js");
  const grab = (src) => {
    const m = src.match(/NAME_TOKEN\s*=\s*(\/\^\[[^\n]*?\/)\s*;/);
    return m && m[1];
  };
  const s = grab(server);
  const c = grab(bridge);
  assert.ok(s, "серверний NAME_TOKEN знайдено");
  assert.ok(c, "клієнтський NAME_TOKEN знайдено");
  assert.equal(c, s, "клієнтський і серверний NAME_TOKEN мають збігатися");
});

test("клієнт має строгий fullNameOk (≥3 токени по ≥2 літери), а не лише ≥3 слова", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /function fullNameOk\(/);
  assert.match(bridge, /tokens\.length < 3/);
  assert.match(bridge, /t\.length >= 2 && NAME_TOKEN\.test\(t\)/);
  // Перевірка ПІБ у полі використовує саме fullNameOk (а не старий ≥3-token).
  assert.match(bridge, /fullNameOk\(nameInput\.value\)/);
});

test("інлайн-фідбек показує .field-error на blur (таймінг до сабміту)", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /function bindInlineValidation\(/);
  assert.match(bridge, /addEventListener\('blur'/);
  assert.match(bridge, /dataset\.touched = '1'/);
  assert.match(bridge, /field-error/);
  assert.match(bridge, /checkValidity\(\)/);
  assert.match(bridge, /if \(civilForm\) bindInlineValidation\(civilForm\)/);
});
