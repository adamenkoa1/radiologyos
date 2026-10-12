// Картотека пацієнтів (`/staff/patients`) мутує картку (PUT), створює пацієнта
// (PUT) і логує комунікацію (POST). Раніше saveProfile/createPatient/
// logCommunication робили setSaving(true) → fetch → response.json() →
// setSaving(false) без try/catch/finally: мережевий кидок або не-JSON відповідь
// пропускали setSaving(false) і лишали кнопку «Зберегти» навічно заблокованою
// без помилки. Стійкість тепер дає спільний хук useSubmit.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("patient mutations are guarded by the shared useSubmit hook", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /import \{ useSubmit \} from "\.\.\/\.\.\/hooks\/use-submit"/);
  // onError піднімає мережевий кидок замість мовчазного no-op
  assert.match(page, /useSubmit\(onActionError\)/);
  assert.match(page, /setActionError\("Не вдалося виконати дію/);
  // усі три мутації виконують fetch усередині run()
  assert.match(page, /async function saveProfile[\s\S]*?await run\(async \(\) => \{/);
  assert.match(page, /async function createPatient[\s\S]*?await run\(async \(\) => \{/);
  assert.match(page, /async function logCommunication[\s\S]*?await run\(async \(\) => \{/);
  // рукописний busy-стан прибрано — busy приходить із хука (alias saving)
  assert.doesNotMatch(page, /setSaving\(/);
});

test("patient fetch handlers tolerate a non-JSON response body", async () => {
  const page = await read("app/staff/patients/page.tsx");
  // жоден response.json() не падає на порожньому/HTML тілі
  assert.doesNotMatch(page, /await response\.json\(\) as/);
  // мутації: порожній обʼєкт; завантаження: null → екран «Повторити»/помилка
  assert.match(page, /await response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(page, /await response\.json\(\)\.catch\(\(\) => null\)/);
});

test("patient status and error messages carry screen-reader roles", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /className="staffError" role="alert">\{actionError\}/);
  assert.match(page, /className="staffSuccess" role="status">\{actionSuccess\}/);
});

test("patient search input has an accessible name (placeholder is not a label)", async () => {
  const page = await read("app/staff/patients/page.tsx");
  // Єдиний голий input (решта обгорнуті в <label>) — пошук у списку.
  assert.match(page, /<input type="search".*aria-label="Пошук пацієнтів за ПІБ, телефоном або тегом"/);
});

test("selected patient in the list is exposed via aria-current", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /aria-current=\{selectedPatientKey===key \? "true" : undefined\}/);
});

test("card loading placeholder is announced as a status", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /<div className="protocolPlaceholder" role="status" aria-live="polite">/);
});
