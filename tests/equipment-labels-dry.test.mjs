// DRY: мапа модальностей {ct,xray,fluoro} раніше дублювалася ідентично на ~7
// staff-сторінках/компонентах під різними іменами. Канонізовано у
// lib/labels.ts (EQUIPMENT_LABELS). Цей гард не дає інлайн-дублю повернутися.
//
// Статус-мапи свідомо НЕ консолідовані: вони розходяться за контекстом
// (повні vs компактні підписи записів) і доменом (апарати/ТО/health/addendum).

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("EQUIPMENT_LABELS is the single canonical modality map", () => {
  const labels = read("lib/labels.ts");
  assert.match(labels, /export const EQUIPMENT_LABELS: Record<string, string> = \{/);
  assert.match(labels, /ct: "КТ"/);
  assert.match(labels, /xray: "Рентген"/);
  assert.match(labels, /fluoro: "Флюорограф"/);
});

test("no staff file re-declares the inline modality literal", () => {
  const dir = "app/staff";
  const files = readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true })
    .filter((p) => String(p).endsWith(".tsx"))
    .map((p) => `${dir}/${p}`);
  const re = /ct:\s*"КТ"[\s\S]{0,40}?xray:\s*"Рентген"[\s\S]{0,40}?fluoro:\s*"Флюорограф"/;
  const offenders = files.filter((f) => re.test(read(f)));
  assert.deepEqual(offenders, [], "ці файли дублюють EQUIPMENT_LABELS інлайн — імпортуйте з lib/labels");
});
