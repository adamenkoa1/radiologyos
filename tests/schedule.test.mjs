import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  candidateTimesFor, isDayOpen, parseSchedule, sanitizeSchedule, SCHEDULE_DEFAULTS,
} from "../lib/schedule.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("candidateTimesFor honours start/end/step and study duration", () => {
  const t = candidateTimesFor({ start: "08:00", end: "09:00", slotMinutes: 30 }, 30);
  assert.deepEqual(t, ["08:00", "08:30"]); // 09:00 не влазить (30 хв)
  const t2 = candidateTimesFor({ start: "08:00", end: "09:00", slotMinutes: 15 }, 60);
  assert.deepEqual(t2, ["08:00"]); // лише один слот на 60 хв
});

test("isDayOpen respects weekdays and specific days-off", () => {
  const cfg = sanitizeSchedule({ weekdays: [1, 2, 3, 4, 5], daysOff: ["2026-08-04"] });
  assert.equal(isDayOpen("2026-08-02", cfg), false); // неділя
  assert.equal(isDayOpen("2026-08-01", cfg), false); // субота вимкнена (лише 1-5)
  assert.equal(isDayOpen("2026-08-03", cfg), true);  // понеділок
  assert.equal(isDayOpen("2026-08-04", cfg), false); // вихідний зі списку
});

test("sanitizeSchedule clamps invalid input to safe defaults", () => {
  const c = sanitizeSchedule({ equipment: { ct: { start: "25:99", end: "08:00", slotMinutes: 9999 } }, weekdays: [0, 9], daysOff: ["bad", "2026-01-01"] });
  assert.deepEqual(c.equipment.ct, SCHEDULE_DEFAULTS.equipment.ct); // некоректні години → типові
  assert.deepEqual(c.weekdays, SCHEDULE_DEFAULTS.weekdays); // 0/9 відкинуто → типові
  assert.deepEqual(c.daysOff, ["2026-01-01"]); // лишилась лише валідна дата
});

test("parseSchedule returns defaults for empty/invalid JSON", () => {
  assert.deepEqual(parseSchedule(""), sanitizeSchedule({}));
  assert.deepEqual(parseSchedule("{oops"), sanitizeSchedule({}));
});

test("availability and staff booking read the configurable schedule", async () => {
  const avail = await read("app/api/availability/route.ts");
  assert.match(avail, /parseSchedule\(await getSetting\(db, SCHEDULE_KEY\)\)/);
  assert.match(avail, /isDayOpen\(date, schedule\)/);
  assert.match(avail, /candidateTimesFor\(hoursFor\(schedule/);
  assert.match(avail, /equipment_blocks/); // збережено фільтр блокувань
  assert.match(avail, /status IN \('confirmed','rescheduled'\)/);
  const book = await read("app/api/staff/bookings/route.ts");
  assert.match(book, /candidateTimesFor\(hoursFor\(schedule/);
  assert.match(book, /isDayOpen\(desiredDate, schedule\)/);
});

test("schedule editor and admin API are wired and guarded", async () => {
  const route = await read("app/api/staff/schedule/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(route, /sanitizeSchedule\(body\.schedule\)/);
  assert.match(route, /setSetting\(db, SCHEDULE_KEY/);
  const page = await read("app/staff/schedule/page.tsx");
  assert.match(page, /active="schedule"/);
  assert.match(page, /Робочі дні тижня/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/schedule"/);
});
