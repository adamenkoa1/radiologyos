// «Пісочниця» конструктора протоколів (/staff/protocols). Перевіряє через
// інспекцію джерела, що демо-режим відкриває редактор без дослідження, НЕ пише
// в БД (save заблоковано; збереження/макроси/шаблони/AI сховані) і що синтетичне
// бронівання має id -1.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("sandbox entry points exist (queue button + empty-state link)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /className="protocolSandboxButton"[^>]*onClick=\{\(\)=>sandbox \? exitSandbox\(\) : startSandbox\(\)\}/);
  assert.match(page, /className="protocolSandboxLink" onClick=\{startSandbox\}/);
});

test("startSandbox builds an in-memory booking (id -1) and a CT draft, no network call", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const fn = page.slice(page.indexOf("function startSandbox"), page.indexOf("function exitSandbox"));
  assert.match(fn, /id: -1/);
  assert.match(fn, /normalDocument\(SANDBOX_TEMPLATE\)/);
  assert.match(fn, /setSandbox\(true\)/);
  assert.doesNotMatch(fn, /fetch\(/); // суто локально
  assert.match(page, /const SANDBOX_TEMPLATE = "ct_brain"/);
});

test("save is blocked in sandbox (no DB write, no lifecycle change)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /if \(sandbox\) \{ setActionError\("Пісочниця — збереження недоступне[^]*?\); return; \}/);
  // Кнопки збереження чернетки сховані в пісочниці.
  assert.match(page, /\{!sandbox && canEdit && doc\.status === "draft" && </);
});

test("persistence-bound panels (macros, templates, AI, critical) are hidden in sandbox", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // Дві панелі protocolMacros (макроси + мої шаблони) та aiAssist — усі за !sandbox.
  const macroGates = [...page.matchAll(/\{!sandbox && canEdit && mode !== "quick" && <section className="protocolMacros">/g)];
  assert.equal(macroGates.length, 2);
  assert.match(page, /\{!sandbox && canEdit && mode !== "quick" && <section className="aiAssist">/);
  assert.match(page, /canManage && !sandbox && <button[\s\S]*?flagCritical/);
});

test("entering a real booking leaves sandbox", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const fn = page.slice(page.indexOf("async function openBooking"), page.indexOf("async function openBooking") + 400);
  assert.match(fn, /setSandbox\(false\)/);
});

test("sandbox banner is declared, themed and hidden on print", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /sandbox && <p className="protocolSandboxBanner"/);
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /\.protocolSandboxBanner\{/);
  assert.match(css, /\.protocolSandboxBanner,/); // у списку print-hide
  const dark = await read("app/styles/08-dark-theme.css");
  assert.match(dark, /\.themeDark \.protocolSandboxBanner/);
});
