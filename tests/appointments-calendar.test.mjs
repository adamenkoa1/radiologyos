import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("appointments calendar page reads real bookings and offers list/day views", async () => {
  const page = await read("app/staff/appointments/page.tsx");
  assert.match(page, /active="appointments"/);
  assert.match(page, /\/api\/staff\/bookings/); // реальні дані, без нового бекенду
  assert.match(page, /view === "list"/);
  assert.match(page, /view === "day"/);
  assert.match(page, /apptTimeline/); // таймлайн по годинах
  assert.match(page, /stateLabel\(/); // людські підписи станів
});

test("status filter tabs map to real booking statuses", async () => {
  const page = await read("app/staff/appointments/page.tsx");
  for (const s of ["planned", "confirmed", "arrived", "inroom", "done", "cancelled"]) {
    assert.match(page, new RegExp(`${s}:`), `group ${s} present`);
  }
  assert.match(page, /"confirmed": \["confirmed"\]|confirmed: \["confirmed"\]/);
  assert.match(page, /"new"|new,/); // legacy-статус у групі «Заплановані»
});

test("calendar offers a Google-style week grid with navigation", async () => {
  const page = await read("app/staff/appointments/page.tsx");
  assert.match(page, /view === "week"/);
  assert.match(page, /apptWeek/); // сітка тижня
  assert.match(page, /weekDates\(/); // тиждень від понеділка
  assert.match(page, /Тиждень/);
  assert.match(page, /Сьогодні/); // навігація
});

test("confirming a booking opens the week schedule on its date", async () => {
  const page = await read("app/staff/page.tsx");
  assert.match(page, /\/staff\/appointments\?view=week&date=/);
});

test("calendar is wired into the staff shell and nav", async () => {
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/appointments"/);
  assert.match(shell, /"appointments"/); // у типі WorkspaceSection
  assert.match(shell, /Календар записів/);
});
