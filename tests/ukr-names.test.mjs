import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  UKR_NAMES,
  UKR_PATRONYMICS,
  nameTokenAt,
  nameSuggestions,
  applyNameSuggestion,
} from "../lib/ukr-names.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Витягує масив рядкових літералів (var NAME = [...]) із публічного JS.
function jsArray(src, varName) {
  const m = src.match(new RegExp(`var ${varName} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${varName} не знайдено у name-suggest.js`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

test("token position: 2-е слово → ім'я, 3-є → по батькові", () => {
  assert.equal(nameTokenAt("Іваненко ").idx, 1);
  assert.equal(nameTokenAt("Іваненко Іван").idx, 1);
  assert.equal(nameTokenAt("Іваненко Іван").prefix, "Іван");
  assert.equal(nameTokenAt("Іваненко Іван ").idx, 2);
  assert.equal(nameTokenAt("Іваненко Іван Іван").idx, 2);
});

test("suggestions: імена для 2-го токена, по батькові для 3-го, нічого для прізвища", () => {
  assert.equal(nameSuggestions("Ів").length, 0); // прізвище — без підказок
  assert.ok(nameSuggestions("Іваненко Оле").includes("Олександр"));
  assert.ok(nameSuggestions("Іваненко Іван Олек").includes("Олександрович"));
  assert.ok(nameSuggestions("Іваненко Іван Олек").every((s) => UKR_PATRONYMICS.includes(s)));
});

test("apply: підстановка у правильний токен, пробіл після імені", () => {
  assert.equal(applyNameSuggestion("Іваненко Оле", "Олександр"), "Іваненко Олександр ");
  assert.equal(applyNameSuggestion("Іваненко Іван Олек", "Олександрович"), "Іваненко Іван Олександрович");
});

test("публічний name-suggest.js має ті самі списки, що й lib/ukr-names.ts", async () => {
  const js = await read("public/site/assets/name-suggest.js");
  assert.deepEqual(jsArray(js, "NAMES"), [...UKR_NAMES]);
  assert.deepEqual(jsArray(js, "PATRO"), [...UKR_PATRONYMICS]);
});

test("React-форма реєстратора підключає підказки ПІБ", async () => {
  const page = await read("app/staff/book/page.tsx");
  assert.match(page, /import NameSuggestInput from "\.\.\/NameSuggestInput"/);
  assert.match(page, /<NameSuggestInput name="name"[^>]*value=\{name\} onChange=\{setName\}/);
  const comp = await read("app/staff/NameSuggestInput.tsx");
  assert.match(comp, /nameSuggestions|applyNameSuggestion/);
});
