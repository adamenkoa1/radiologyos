// Явні режими роботи редактора протоколів (Этап D3, §6 MASTER-завдання):
// Швидкий / Структурований / Вільний. Режим — суто ВІЗУАЛЬНА перевага:
// перемикання не стирає й не перезаписує поля (структуровані дані живуть у
// `doc`). Перевіряємо, що toggle підключено, дефолт — структурований, і що
// перемикач не мутує документ.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("editor exposes a three-way work-mode toggle with aria-pressed, default structured", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /const \[mode,setMode\] = useState<"quick"\|"structured"\|"free">\("structured"\)/);
  assert.match(page, /role="group" aria-label="Режим роботи"/);
  for (const label of ["Швидкий", "Структурований", "Вільний"]) assert.match(page, new RegExp(`>${label}<`));
  assert.match(page, /aria-pressed=\{mode==="quick"\}/);
  assert.match(page, /aria-pressed=\{mode==="structured"\}/);
  assert.match(page, /aria-pressed=\{mode==="free"\}/);
});

test("switching mode is a pure view change — the toggle never mutates the document", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // Кнопки режиму викликають лише setMode(...), без setDoc/patchDoc/fetch/save.
  const toggleBlock = page.slice(page.indexOf('aria-label="Режим роботи"'), page.indexOf('aria-label="Режим роботи"') + 600);
  assert.match(toggleBlock, /onClick=\{\(\)=>setMode\("quick"\)\}/);
  assert.match(toggleBlock, /onClick=\{\(\)=>setMode\("structured"\)\}/);
  assert.match(toggleBlock, /onClick=\{\(\)=>setMode\("free"\)\}/);
  assert.doesNotMatch(toggleBlock, /setDoc|patchDoc|fetch\(|save\(/);
});

test("structured sections and the findings composer are hidden outside structured mode", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // Секції й композер рендеряться лише у структурованому режимі (умовний рендер,
  // стан полів у `doc` зберігається при поверненні).
  assert.match(page, /\{mode === "structured" && template\.sections\.map\(\(section\)=><div className="protocolSection"/);
  assert.match(page, /\{canEdit && mode === "structured" && composerRegion && <section className="findingComposer">/);
});

test("fillNorms still only fills EMPTY fields (never overwrites manual edits)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const fill = page.slice(page.indexOf("function fillNorms"), page.indexOf("async function save"));
  assert.match(fill, /if \(field\.normal && !values\[field\.key\]\?\.trim\(\)\) values\[field\.key\] = field\.normal/);
});

test("work mode resets to structured when opening another protocol", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const reset = page.slice(page.indexOf("function resetComposer"), page.indexOf("function resetComposer") + 300);
  assert.match(reset, /setMode\("structured"\)/);
});
