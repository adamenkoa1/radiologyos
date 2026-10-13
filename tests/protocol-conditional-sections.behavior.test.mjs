// Умовні секції/поля шаблонів протоколу (Этап D4b, §4). Перевірка через
// інспекцію джерела (так само, як решта тестів protocols — lib/protocols.ts не
// імпортується в рантаймі через extensionless "./catalog", який резолвить лише
// бандлер). Фіксуємо, що механізм showWhen вбудовано в типи, рушій рендеру,
// санітайзер і редактор, і що безумовні поля лишаються незмінними.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("protocols lib defines the conditional-visibility type and helper", async () => {
  const lib = await read("lib/protocols.ts");
  assert.match(lib, /export type FieldCondition = \{/);
  assert.match(lib, /showWhen\?: FieldCondition;/);
  assert.match(lib, /export function isConditionMet\(condition: FieldCondition \| undefined, sections: ProtocolSectionValues\): boolean/);
});

test("a conditional contrast-phase field is wired to IV contrast", async () => {
  const lib = await read("lib/protocols.ts");
  assert.match(lib, /const contrastPhase: ProtocolField = \{/);
  assert.match(lib, /key: "contrastPhase"/);
  assert.match(lib, /showWhen: \{ section: "parameters", field: "contrast", in: \["Внутрішньовенне контрастування"\] \}/);
  // Додано у параметри КТ-шаблонів.
  assert.match(lib, /fields: \[contrast, contrastPhase\]/);
});

test("renderProtocolText honours showWhen for sections and fields", async () => {
  const lib = await read("lib/protocols.ts");
  assert.match(lib, /if \(!isConditionMet\(section\.showWhen, document\.sections\)\) continue;/);
  assert.match(lib, /\.filter\(\(field\) => isConditionMet\(field\.showWhen, document\.sections\)\)/);
});

test("sanitizeDocument drops hidden conditional values and sections", async () => {
  const lib = await read("lib/protocols.ts");
  // Пост-прохід: порожнить секцію з невиконаною умовою й видаляє приховані поля.
  assert.match(lib, /if \(!isConditionMet\(section\.showWhen, sections\)\) \{ sections\[section\.key\] = \{\}; continue; \}/);
  assert.match(lib, /if \(field\.showWhen && !isConditionMet\(field\.showWhen, sections\)\) delete values\[field\.key\]/);
});

test("the editor hides unmet conditional sections and fields (and print mirrors it)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /isConditionMet/);
  // Фільтрація секцій і полів у редакторі.
  assert.match(page, /template\.sections\.filter\(\(section\)=>isConditionMet\(section\.showWhen, doc\.sections\)\)/);
  assert.match(page, /section\.fields\.filter\(\(field\)=>isConditionMet\(field\.showWhen, doc\.sections\)\)/);
});
