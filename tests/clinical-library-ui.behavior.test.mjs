// Інтеграція імпортованої клінічної бібліотеки в конструктор (MP4 PR3).
// Перевіряє через інспекцію джерела, що блок «на перевірці» доданий АДИТИВНО:
// append у findings/conclusion, без мережі/збереження/зміни статусу, гейтиться
// редагованістю + структурованим режимом + ділянкою, показує дисклеймер і
// попередження про можливий дублікат.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("editor imports the pure library renderer/adapter, not duplicated logic", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /from "\.\.\/\.\.\/\.\.\/lib\/clinical-library-finding"/);
  assert.match(page, /from "\.\.\/\.\.\/\.\.\/lib\/clinical-library-adapter"/);
  assert.match(page, /renderLibraryFinding/);
  assert.match(page, /planImport/);
});

test("only 'create' findings in agreed catalog regions are offered", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /item\.action !== "create"/); // skips non-create
  assert.match(page, /FINDING_REGION_TO_CATALOG\[finding\.region\]/); // region-gated
});

test("library draft insert is additive (append to findings+conclusion, no overwrite)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const fn = page.slice(page.indexOf("function addLibraryFinding"), page.indexOf("function addComposedFinding"));
  assert.match(fn, /baseF \? `\$\{baseF\}\\n\$\{result\.description\}` : result\.description/);
  assert.match(fn, /baseC \? `\$\{baseC\}\\n\$\{result\.conclusion\}` : result\.conclusion/);
  // Нічого не зберігає, не шле запит і не змінює статус документа.
  assert.doesNotMatch(fn, /fetch\(/);
  assert.doesNotMatch(fn, /\bsave\(/);
  assert.doesNotMatch(fn, /status:/);
});

test("library panel is gated by canEdit + structured mode + composerRegion (same as composer)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // Блок живе всередині секції, що гейтиться canEdit && mode==="structured" && composerRegion.
  assert.match(page, /canEdit && mode === "structured" && composerRegion && <section className="findingComposer">/);
  assert.match(page, /libCandidates\.length > 0 && <div className="libraryImport">/);
});

test("panel shows the unvalidated-draft disclaimer and a possible-duplicate caution", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /НЕперевірені шаблони \(draft\)/);
  assert.match(page, /libSelected\?\.possibleDuplicateOf && <p className="findingComposerWarn"/);
});

test("insert button is disabled until required params are filled", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /disabled=\{!libReady \|\| saving\}/);
  assert.match(page, /libActiveParams\.filter\(\(p\) => p\.required\)\.every/);
});

test("libraryImport class is declared and hidden on print (nested in print-hidden composer) + dark theme", async () => {
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /\.libraryImport\{/);
  assert.match(css, /@media print\{\.findingComposer\{display:none!important\}\}/);
  const dark = await read("app/styles/08-dark-theme.css");
  assert.match(dark, /\.themeDark \.libraryImport/);
});
