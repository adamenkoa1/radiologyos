// «Додати в календар»: коректний Google Calendar URL. Серверний /api/site-booking
// (яким користується персонал) досі повертає calendarUrl; публічна форма стала
// месенджер-хендофом без екрана підтвердження, тож блок календаря там прибрано.

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

test("серверний запис досі будує calendarUrl для персоналу", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /import \{ googleCalendarUrl \}/);
  assert.match(route, /calendarUrl: googleCalendarUrl\(/);
});

test("публічний месенджер-хендоф не має екрана підтвердження з календарем", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.doesNotMatch(bridge, /renderCalendarLinks|appt\.calendarUrl/);
  for (const page of ["public/site/price.html", "public/site/index.html"]) {
    assert.doesNotMatch(await read(page), /id="calendarBlock"/, `${page} без контейнера календаря`);
  }
});
