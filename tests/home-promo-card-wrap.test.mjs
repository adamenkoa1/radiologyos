// Головна (public/site/index.html): довгий заголовок аудиторної картки
// «Військовослужбовцям» має переноситися всередині картки на мобільному, а не
// вилазити за її край. Перевіряємо, що правило заголовка дозволяє розрив слова.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("promo card title can break so a long single word never overflows", async () => {
  const html = await readFile(new URL("../public/site/index.html", import.meta.url), "utf8");
  const rule = html.match(/\.promo-text strong\{[^}]*\}/);
  assert.ok(rule, "правило .promo-text strong існує");
  assert.match(rule[0], /overflow-wrap:break-word/);
});
