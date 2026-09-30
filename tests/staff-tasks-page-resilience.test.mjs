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

test("creating a task guards against double-submit and a network throw", async () => {
  const page = await read("app/staff/tasks/page.tsx");
  // guard: no re-entry while a create request is in flight
  assert.match(page, /if\(!form\.title\.trim\(\)\|\|submitting\) return;/);
  assert.match(page, /setSubmitting\(true\);/);
  // the POST is wrapped so a network throw surfaces an error instead of a silent no-op
  assert.match(page, /createTask[\s\S]*?catch \{[\s\S]*?setError\([^)]*Не вдалося створити завдання/);
  assert.match(page, /finally \{setSubmitting\(false\);\}/);
  // the submit button reflects the in-flight state and cannot be re-clicked
  assert.match(page, /disabled=\{!form\.title\.trim\(\)\|\|submitting\}/);
  assert.match(page, /submitting\?"Створення…"/);
  // background refresh is paused during submit too
  assert.match(page, /pauseRef\.current = busy!==null \|\| creating \|\| submitting;/);
});
