// Реєстр персоналу: підсумкова плитка «Графіки» показує лічильник (а не
// заглушку), реєстр фільтрується за статусом (Працюють/Архів), а пошук
// охоплює табельний номер. Перевірка — на рівні джерела (frontend-тести).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE = new URL("../app/staff/personnel/page.tsx", import.meta.url);

test("плитка «Графіки» показує лічильник, а не літерал-заглушку", async () => {
  const src = await readFile(PAGE, "utf8");
  assert.doesNotMatch(src, />Calendar6</, "залишок-заглушка Calendar6 має бути прибрана");
  assert.match(src, /Графіки<\/span><b>\{data\?\.workSchedules\.filter/, "плитка рахує активні графіки");
});

test("реєстр має фільтр статусу (Працюють/Архів)", async () => {
  const src = await readFile(PAGE, "utf8");
  assert.match(src, /statusFilter/);
  assert.match(src, /aria-label="Фільтр статусу"/);
  assert.match(src, /<option value="active">Працюють<\/option>/);
  assert.match(src, /<option value="archived">Архів<\/option>/);
  // Логіка фільтра за активністю.
  assert.match(src, /statusFilter === "active" && !record\.active/);
  assert.match(src, /statusFilter === "archived" && record\.active/);
});

test("пошук охоплює табельний номер", async () => {
  const src = await readFile(PAGE, "utf8");
  assert.match(src, /record\.militaryRank,\s*record\.staffNumber\]/);
});
