// Інтеграція перевірки суперечностей у редактор (MP3 E2). Перевіряє, що панель
// дорадча (не переписує текст), рахується з поточного документа й оголошена в CSS.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("editor wires the deterministic contradiction checker, advisory only", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /from "\.\.\/\.\.\/\.\.\/lib\/protocol-contradictions"/);
  assert.match(page, /const contradictions = doc\s*\?\s*findContradictions\(/);
  assert.match(page, /contradictions\.length > 0 && <section className="protocolContradictions"/);
  // Явно дорадчий характер — текст не змінюється автоматично.
  assert.match(page, /текст не змінюється автоматично/);
  // Блок не містить виклику збереження чи мутації документа.
  const block = page.slice(page.indexOf('className="protocolContradictions"'), page.indexOf('className="protocolContradictions"') + 500);
  assert.doesNotMatch(block, /setDoc|patchDoc|fetch\(|save\(/);
});

test("contradiction panel classes are declared (incl. dark theme) and print-hidden", async () => {
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /\.protocolContradictions\{/);
  assert.match(css, /@media print\{\.protocolContradictions\{display:none!important\}\}/);
  const dark = await read("app/styles/08-dark-theme.css");
  assert.match(dark, /\.themeDark \.protocolContradictions/);
});
