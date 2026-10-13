// Інтеграція конструктора знахідок у редактор протоколів (app/staff/protocols/
// page.tsx). Перевіряє, що блок додано АДИТИВНО: він пише у findings/conclusion
// через insertComposedFinding (append, не overwrite), гейтиться canEdit +
// змодельованою ділянкою, не чіпає lifecycle/підпис/API та зникає на друці.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("editor wires the structured findings composer additively", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // Імпортує чистий композер, а не дублює логіку.
  assert.match(page, /from "\.\.\/\.\.\/\.\.\/lib\/findings-composer"/);
  assert.match(page, /composeFinding/);
  assert.match(page, /insertComposedFinding/);
  // Блок гейтиться редагованістю, структурованим режимом і змодельованою ділянкою.
  assert.match(page, /canEdit && mode === "structured" && composerRegion && <section className="findingComposer">/);
  // Складений текст іде через append-хелпер у findings+conclusion (не overwrite).
  assert.match(page, /insertComposedFinding\(docToProtocol\(doc\), result\.finding\)/);
  assert.match(page, /patchDoc\(\{ findings:merged\.findings, conclusion:merged\.conclusion \}\)/);
});

test("composer does not touch lifecycle, signing, API contract or immutability", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // Додавання знахідки не викликає збереження/підпис і не шле запит.
  const composerFn = page.slice(page.indexOf("function addComposedFinding"), page.indexOf("// ── Персональні макроси"));
  assert.doesNotMatch(composerFn, /fetch\(/);
  assert.doesNotMatch(composerFn, /save\(/);
  assert.doesNotMatch(composerFn, /status:/); // не змінює статус документа
  // Клінічне блокування підписаного/виданого протоколу збережено без змін.
  assert.match(page, /const clinicalLocked = doc\?\.status === "signed" \|\| doc\?\.status === "issued";/);
  assert.match(page, /const canSign = staff\?\.role === "radiologist" && doc\?\.status === "ready";/);
});

test("composer surfaces the finding clinical hint (§4)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /composerFinding\?\.hint && <small className="protocolFieldHint">\{composerFinding\.hint\}<\/small>/);
});

test("composer is hidden for non-modeled templates and on print", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /canEdit && mode === "structured" && !composerRegion && <p className="protocolReadonlyHint">/);
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /@media print\{\.findingComposer\{display:none!important\}\}/);
});

test("composer classes are declared in the stylesheet (no dead/undeclared class)", async () => {
  const css = await read("app/styles/02-workspace.css");
  for (const cls of ["findingComposer", "findingComposerControls", "findingComposerMods", "findingComposerWarn"]) {
    assert.match(css, new RegExp(`\\.${cls}[{ ,]`), `${cls} declared`);
  }
  const dark = await read("app/styles/08-dark-theme.css");
  assert.match(dark, /\.themeDark \.findingComposer/);
});
