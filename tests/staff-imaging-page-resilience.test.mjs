// Модуль «Знімки та DICOM/PACS» виконує мутації картки дослідження та
// налаштувань PACS. Раніше saveStudy/resolveByAccession/saveSettings робили
// setSaving(true) → fetch → response.json() → setSaving(false) без
// try/catch/finally: мережевий кидок або не-JSON відповідь пропускали
// setSaving(false) і лишали кнопку «Зберегти» навічно заблокованою без помилки.
// Стійкість тепер дає спільний хук useSubmit.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("imaging mutations are guarded by the shared useSubmit hook", async () => {
  const page = await read("app/staff/imaging/page.tsx");
  // стійкість — зі спільного хука, а не рукописного try/catch на сторінці
  assert.match(page, /import \{ useSubmit \} from "\.\.\/\.\.\/hooks\/use-submit"/);
  // onError піднімає мережевий кидок замість мовчазного no-op
  assert.match(page, /useSubmit\(onActionError\)/);
  assert.match(page, /setActionError\("Не вдалося виконати дію/);
  // усі три мутації виконують fetch усередині run()
  assert.match(page, /async function saveStudy[\s\S]*?await run\(async \(\) => \{/);
  assert.match(page, /async function resolveByAccession[\s\S]*?await run\(async \(\) => \{/);
  assert.match(page, /async function saveSettings[\s\S]*?await run\(async \(\) => \{/);
  // рукописний busy-стан прибрано — busy приходить із хука (alias saving)
  assert.doesNotMatch(page, /setSaving\(/);
  assert.doesNotMatch(page, /useState\(false\);?\s*\/\/[^\n]*saving/);
});

test("imaging fetch handlers tolerate a non-JSON response body", async () => {
  const page = await read("app/staff/imaging/page.tsx");
  // жоден response.json() не падає на порожньому/HTML тілі
  assert.doesNotMatch(page, /await response\.json\(\) as/);
  assert.match(page, /await response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
});

test("imaging load handlers survive a network throw", async () => {
  const page = await read("app/staff/imaging/page.tsx");
  // openBooking показує помилку, а не лишає картку в стані «завантаження»
  assert.match(page, /async function openBooking[\s\S]*?try \{[\s\S]*?\} catch \{[\s\S]*?setActionError/);
  // loadSettings — void-виклик, тож його кидок не має валити весь екран
  assert.match(page, /const loadSettings = useCallback\(async \(\) => \{\s*try \{/);
});
