// Сторінка протоколів має показувати явну помилку з «Повторити» при збої
// завантаження черги (а не тиху порожню чергу) і тихо автооновлювати чергу.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("protocol queue shows an explicit error with retry instead of a silent empty queue", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /async function loadQueue\(\{ background = false \} = \{\}\)/);
  assert.match(page, /catch \{[\s\S]*?if \(!background\) setLoadError\(true\)/);
  assert.match(page, /loadError \?/);
  assert.match(page, /Повторити/);
  assert.match(page, /setLoadError\(false\); void loadQueue\(\);/);
});

test("protocol queue auto-refreshes without disrupting active editing", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /void loadQueue\(\{ background:true \}\)/);
  assert.match(page, /\}, 45000\)/);
  // Пауза під час збереження/відкриття/AI-чернетки й на прихованій вкладці.
  assert.match(page, /document\.hidden \|\| busyRef\.current/);
  assert.match(page, /busyRef\.current = saving \|\| bookingLoading \|\| aiLoading/);
});

test("protocol queue search has an accessible name (placeholder is not a label)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /<input type="search".*aria-label="Пошук у черзі протоколів за кодом, ПІБ або дослідженням"/);
});

test("selected protocol in the queue is exposed via aria-current", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /aria-current=\{selectedId === item\.id \? "true" : undefined\}/);
});

test("protocol loading placeholder is announced as a status", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /<div className="protocolPlaceholder" role="status" aria-live="polite">/);
});

test("queue filter tabs and list items have a visible keyboard focus ring", async () => {
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /\.protocolFilterTabs button:focus-visible\{outline:2px solid #0d5b50;outline-offset:2px\}/);
  assert.match(css, /\.protocolQueueItem:focus-visible\{outline:2px solid #0d5b50;outline-offset:2px\}/);
});
