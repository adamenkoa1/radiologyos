// «Додати в календар»: коректний Google Calendar URL і його наявність у
// відповіді запису та на екрані підтвердження.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { googleCalendarUrl } from "../lib/calendar-link.ts";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const dates = (u) => new URL(u).searchParams.get("dates");

test("URL має коректні дати, пояс і назву", () => {
  const url = googleCalendarUrl({
    title: "Дослідження: КТ ОГК", date: "2026-09-18", time: "09:45",
    durationMinutes: 15, details: "Заявка RD-1", location: "Чернігів",
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(u.searchParams.get("action"), "TEMPLATE");
  assert.equal(u.searchParams.get("dates"), "20260918T094500/20260918T100000");
  assert.equal(u.searchParams.get("ctz"), "Europe/Kyiv");
  assert.equal(u.searchParams.get("text"), "Дослідження: КТ ОГК");
  assert.equal(u.searchParams.get("location"), "Чернігів");
});

test("тривалість коректно переходить межу години та доби", () => {
  assert.equal(dates(googleCalendarUrl({ title: "x", date: "2026-09-18", time: "09:50", durationMinutes: 30 })), "20260918T095000/20260918T102000");
  assert.equal(dates(googleCalendarUrl({ title: "x", date: "2026-09-18", time: "23:50", durationMinutes: 30 })), "20260918T235000/20260919T002000");
});

test("некоректні дата/час/назва → порожній рядок", () => {
  assert.equal(googleCalendarUrl({ title: "x", date: "18.09.2026", time: "09:45", durationMinutes: 15 }), "");
  assert.equal(googleCalendarUrl({ title: "x", date: "2026-09-18", time: "9:45", durationMinutes: 15 }), "");
  assert.equal(googleCalendarUrl({ title: "", date: "2026-09-18", time: "09:45", durationMinutes: 15 }), "");
});

test("екран підтвердження має контейнер і клієнтський рендер", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /function renderCalendarLinks/);
  assert.match(bridge, /appt\.calendarUrl/);
  for (const page of ["public/site/price.html", "public/site/index.html"]) {
    assert.match(await read(page), /id="calendarBlock"/, `${page} має контейнер календаря`);
  }
});
