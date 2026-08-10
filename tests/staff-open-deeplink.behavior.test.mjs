// Глибоке посилання /staff?open=<id> має відкривати повну картку заявки.
// Поведінкова частина: сторінка рендериться зі своїм параметром без падіння.
// Джерельна частина: перевіряємо саму логіку відкриття (клієнтська взаємодія,
// яку offline-harness не може «клікнути»).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { globalsCss } from "./helpers/css.mjs";
import { withD1, jsonRequest, callWorker } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("/staff?open=<id> renders (does not crash on the param)", async () => {
  await withD1(async (db) => {
    const res = await callWorker(jsonRequest("/staff?open=42", undefined, { method: "GET" }), db);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="bookings"/); // черга заявок присутня
  });
});

test("the root page consumes ?open=, clears filters and targets the booking", async () => {
  const page = await read("app/staff/page.tsx");
  // Читає параметр і перетворює на числовий id.
  assert.match(page, /URLSearchParams\(window\.location\.search\)\.get\("open"\)/);
  assert.match(page, /\/\^\\d\+\$\/\.test\(raw\)/);
  // Знімає фільтри, щоб заявку було видно незалежно від табу/пошуку.
  assert.match(page, /setFilter\("all"\); setDayFilter\(""\)/);
  // Прокрутка + розгортання «Керування записом» + підсвітка.
  assert.match(page, /getElementById\(`booking-\$\{openId\}`\)/);
  assert.match(page, /details\.apptManage/);
  assert.match(page, /scrollIntoView/);
  assert.match(page, /bookingRowFocus/);
  // Кожна картка має якір для прокрутки.
  assert.match(page, /<article id=\{`booking-\$\{item\.id\}`\}/);
});

test("the drawer still deep-links into the full booking editor", async () => {
  const drawer = await read("app/staff/booking-drawer.tsx");
  assert.match(drawer, /\/staff\?open=\$\{b\.id\}#bookings/);
  const css = await globalsCss();
  assert.match(css, /\.bookingRowFocus\{/);
});
