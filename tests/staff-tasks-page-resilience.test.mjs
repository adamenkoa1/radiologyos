// Сторінка завдань має переживати мережевий збій завантаження (без вічного
// спінера) і тихо автооновлювати список.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("tasks page survives a failed load and offers a retry", async () => {
  const page = await read("app/staff/tasks/page.tsx");
  assert.match(page, /async function load\(\{ background = false \} = \{\}\)/);
  assert.match(page, /catch \{[\s\S]*?setLoadError\(true\); setLoaded\(true\)/);
  assert.match(page, /loadError && !data/);
  assert.match(page, /Повторити/);
  assert.match(page, /setLoadError\(false\); setLoaded\(false\); void load\(\);/);
});

test("tasks page auto-refreshes without disrupting active work", async () => {
  const page = await read("app/staff/tasks/page.tsx");
  assert.match(page, /void load\(\{background:true\}\)/);
  assert.match(page, /\},45000\)/);
  assert.match(page, /document\.hidden\|\|pauseRef\.current/);
  assert.match(page, /pauseRef\.current = busy!==null \|\| creating/);
});
