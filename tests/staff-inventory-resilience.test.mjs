// /staff/inventory: основні операції/дії — postInventory (додати матеріал тощо),
// documentAction (створити/провести/скасувати документ) і openDocument — мали
// try/finally БЕЗ catch. Мережевий кидок від fetch ковтався (виклики через
// await у submit-хендлерах/кнопках), тож операція ставала мовчазним no-op без
// тосту. Додано catch із ⚠-тостом; перезавантаження після успіху — best-effort.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("inventory mutation/action handlers surface a network failure", async () => {
  const page = await read("app/staff/inventory/page.tsx");
  assert.match(page, /async function postInventory[\s\S]*?\} catch \{[\s\S]*?setToast\("⚠ Немає зв'язку — операцію не виконано[\s\S]*?\} finally \{ setBusy\(false\); \}/);
  assert.match(page, /async function documentAction[\s\S]*?\} catch \{[\s\S]*?setToast\("⚠ Немає зв'язку — дію не виконано[\s\S]*?\} finally \{setBusy\(false\);\}/);
  assert.match(page, /async function openDocument[\s\S]*?\} catch \{[\s\S]*?setToast\("⚠ Немає зв'язку — не вдалося відкрити документ[\s\S]*?\} finally \{setBusy\(false\);\}/);
});

test("inventory post-success reload is best-effort (no masquerade as op failure)", async () => {
  const page = await read("app/staff/inventory/page.tsx");
  assert.match(page, /await loadInventory\(\)\.catch\(\(\)=>\{\}\); return true;/);
  assert.match(page, /await Promise\.all\(\[loadInventory\(\),loadDocuments\(\)\]\)\.catch\(\(\)=>\{\}\);/);
});

test("inventory documents action column has an accessible name", async () => {
  const page = await read("app/staff/inventory/page.tsx");
  assert.match(page, /<th>Автор<\/th><th aria-label="Дії"><\/th>/);
});
