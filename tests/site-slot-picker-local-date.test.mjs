// Публічний вибір часу (slots.js) будував список днів так: підпис дня — з
// локальних компонентів (getDay/getDate/getMonth), а значення `iso` — з
// d.toISOString().slice(0,10) (UTC). Для клініки в Europe/Kyiv (UTC+2/+3) вночі
// 00:00–03:00 ці дві дати розходяться: підпис показує «сьогодні», а iso —
// вчорашній. Пацієнт обирав слот, а в заявку (desiredDate) йшла вчорашня дата,
// яку сервер (київський cutoff) відхиляв. Дату тепер беремо з тих самих
// локальних компонентів, тож підпис і значення не можуть розійтися.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("slot picker builds the day's iso from local components, not UTC toISOString", async () => {
  const js = await read("public/site/assets/slots.js");
  // значення дня — з локальних компонентів (узгоджено з підписом)
  assert.match(js, /const iso = d\.getFullYear\(\) \+ '-' \+ pad\(d\.getMonth\(\) \+ 1\) \+ '-' \+ pad\(d\.getDate\(\)\);/);
  // старий UTC-варіант прибрано, щоб підпис і значення не розходилися вночі
  assert.doesNotMatch(js, /d\.toISOString\(\)\.slice\(0, ?10\)/);
});
