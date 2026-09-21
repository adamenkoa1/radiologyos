// Головна: освітній блок «Яке дослідження що показує». Лише реальні модальності
// клініки (флюорографія, рентгенографія, КТ), українською, з дисклеймером, без
// модальностей, яких клініка не пропонує / заборонених термінів (AGENTS.md).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function explainsSection() {
  const html = await readFile(new URL("../public/site/index.html", import.meta.url), "utf8");
  const m = html.match(/<section class="explains"[\s\S]*?<\/section>/);
  assert.ok(m, "секція .explains існує");
  return m[0];
}

test("home has the 'what each study shows' block linking our real modalities", async () => {
  const sec = await explainsSection();
  assert.match(sec, /Яке дослідження що показує/);
  assert.match(sec, /href="\/fluorography">Флюорографія/);
  assert.match(sec, /href="\/xray">Рентгенографія/);
  assert.match(sec, /href="\/ct">Комп’ютерна томографія \(КТ\)/);
  // Дисклеймер: AI/сайт не дає клінічної рекомендації.
  assert.match(sec, /не медична рекомендація/);
});

test("the block advertises no modality the clinic does not offer", async () => {
  const sec = await explainsSection();
  for (const forbidden of [/МРТ/, /ПЕТ/, /мамограф/i, /маммограф/i, /денситометр/i, /\bУЗД\b/]) {
    assert.doesNotMatch(sec, forbidden, `блок не має містити ${forbidden}`);
  }
});
