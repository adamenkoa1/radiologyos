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
