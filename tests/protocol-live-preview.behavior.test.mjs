// Жива панель прев'ю протоколу (Этап D2, §3 MASTER-завдання).
// Перевіряє, що перегляд додано адитивно: кнопка-перемикач, рендер поточного
// документа через renderProtocolText(docToProtocol(doc)) у реальному часі,
// доступний і в режимі перегляду (не лише canEdit), прихований на друці,
// класи оголошені в CSS. Lifecycle/підпис/API не зачіпаються.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("editor exposes a live preview toggle wired to the protocol renderer", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /const \[showPreview,setShowPreview\] = useState\(false\)/);
  // Кнопка-перемикач із aria-pressed.
  assert.match(page, /aria-pressed=\{showPreview\}/);
  assert.match(page, /Попередній перегляд/);
  // Рендер у реальному часі — з поточного документа, без збереження/запиту.
  assert.match(page, /<section className="protocolLivePreview" role="region" aria-label="Попередній перегляд протоколу">/);
  assert.match(page, /<pre>\{renderProtocolText\(docToProtocol\(doc\)\)\}<\/pre>/);
});

test("live preview is read-only and does not touch lifecycle/API", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // Блок прев'ю не містить кнопок збереження/підпису і не шле запитів.
  const start = page.indexOf('className="protocolLivePreview"');
  const slice = page.slice(start, start + 400);
  assert.doesNotMatch(slice, /fetch\(|save\(|onClick/);
});

test("live preview is hidden on print and its classes are declared (incl. dark theme)", async () => {
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /\.protocolLivePreview\{/);
  assert.match(css, /\.protocolLivePreviewHead\{/);
  assert.match(css, /@media print\{\.protocolLivePreview\{display:none!important\}\}/);
  const dark = await read("app/styles/08-dark-theme.css");
  assert.match(dark, /\.themeDark \.protocolLivePreview/);
});
