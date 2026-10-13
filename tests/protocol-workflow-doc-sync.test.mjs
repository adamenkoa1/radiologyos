// Охоронець синхронності docs/workflows.md §6 «Статуси протоколу» з реальним
// кодом/БД. Раніше документація відставала (ready_for_review/delivered — таких
// статусів у коді немає). Фіксуємо канонічні статуси draft→ready→signed→issued,
// щоб дрейф не повернувся непоміченим.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("workflows.md §6 lists the real protocol statuses and no stale terms", async () => {
  const doc = await read("docs/workflows.md");
  const section = doc.slice(doc.indexOf("## 6. Статуси протоколу"), doc.indexOf("## 7."));
  for (const status of ["draft", "ready", "signed", "issued"]) {
    assert.match(section, new RegExp(`\\b${status}\\b`), `§6 mentions ${status}`);
  }
  // Застарілі терміни, яких немає в коді/БД, не повинні повертатися.
  assert.doesNotMatch(section, /ready_for_review/);
  assert.doesNotMatch(section, /delivered/);
});

test("workflows.md §6 states signing is radiologist-only and post-sign changes go through addenda", async () => {
  const doc = await read("docs/workflows.md");
  const section = doc.slice(doc.indexOf("## 6. Статуси протоколу"), doc.indexOf("## 7."));
  assert.match(section, /radiologist/);
  assert.match(section, /addenda/);
  assert.match(section, /append-only/);
});
