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

test("candidateTimesFor skips slots overlapping the lunch break", () => {
  // Обід 13:00–14:00: слоти, що його перетинають, не пропонуються.
  const t = candidateTimesFor({ start: "12:30", end: "14:30", slotMinutes: 15, breakStart: "13:00", breakEnd: "14:00" }, 15);
  assert.deepEqual(t, ["12:30", "12:45", "14:00", "14:15"]);
  // 30-хв дослідження: 12:45+30 перетинає обід → відкидається, 12:30 закінчується рівно о 13:00.
  const t30 = candidateTimesFor({ start: "12:30", end: "15:00", slotMinutes: 15, breakStart: "13:00", breakEnd: "14:00" }, 30);
  assert.deepEqual(t30, ["12:30", "14:00", "14:15", "14:30"]);
});

test("default schedule matches the real outpatient reception windows", () => {
  // Флюорографія: 9:30–13:00 та 14:00–16:00.
  const fluoro = candidateTimesFor(SCHEDULE_DEFAULTS.equipment.fluoro, 15);
  assert.equal(fluoro[0], "09:30");
  assert.ok(fluoro.includes("12:45") && !fluoro.includes("13:00"));
  assert.ok(fluoro.includes("14:00") && fluoro.at(-1) === "15:45");
  // Рентгенографія: 10:00–13:00 та 14:00–15:00.
  const xray = candidateTimesFor(SCHEDULE_DEFAULTS.equipment.xray, 15);
  assert.equal(xray[0], "10:00");
  assert.ok(xray.includes("12:45") && !xray.includes("13:00") && !xray.includes("13:30"));
  assert.ok(xray.includes("14:00") && xray.at(-1) === "14:45");
});

test("sanitizeSchedule keeps a valid break, drops an out-of-range one, inherits default", () => {
  const kept = sanitizeSchedule({ equipment: { ct: { start: "08:00", end: "17:00", slotMinutes: 30, breakStart: "12:00", breakEnd: "13:00" } } });
  assert.equal(kept.equipment.ct.breakStart, "12:00");
  assert.equal(kept.equipment.ct.breakEnd, "13:00");
  // Перерва поза межами робочих годин відкидається.
  const dropped = sanitizeSchedule({ equipment: { ct: { start: "08:00", end: "12:00", slotMinutes: 30, breakStart: "13:00", breakEnd: "14:00" } } });
  assert.equal(dropped.equipment.ct.breakStart, undefined);
  // Явне очищення (порожні поля) прибирає перерву.
  const cleared = sanitizeSchedule({ equipment: { xray: { start: "10:00", end: "15:00", slotMinutes: 15, breakStart: "", breakEnd: "" } } });
  assert.equal(cleared.equipment.xray.breakStart, undefined);
  // Без ключів перерви — успадковується типова.
  const inherited = sanitizeSchedule({ equipment: { fluoro: { start: "09:30", end: "16:00", slotMinutes: 15 } } });
  assert.equal(inherited.equipment.fluoro.breakStart, "13:00");
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
  for (const key of ["open", "close", "breakStart", "breakEnd", "slotStep"]) assert.equal(c.equipment.ct[key], SCHEDULE_DEFAULTS.equipment.ct[key]); // некоректні години → типові
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
  assert.match(avail, /isEquipmentDayOpen\(date, schedule, service\.equipmentId\)/);
  assert.match(avail, /candidateTimesFor\(hoursFor\(schedule/);
  assert.match(avail, /equipment_blocks/); // збережено фільтр блокувань
  assert.match(avail, /status IN \('new','confirmed','rescheduled'\)/);
  const book = await read("app/api/staff/bookings/route.ts");
  assert.match(book, /candidateTimesFor\(hoursFor\(schedule/);
  assert.match(book, /isEquipmentDayOpen\(desiredDate, schedule, service\.equipmentId\)/);
});

test("schedule editor and admin API are wired and guarded", async () => {
  const route = await read("app/api/staff/schedule/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(route, /sanitizeSchedule\(body\.schedule\)/);
  assert.match(route, /setSetting\(db, SCHEDULE_KEY/);
  const page = await read("app/staff/schedule/page.tsx");
  assert.match(page, /active="schedule"/);
  assert.match(page, /Робочі дні/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/schedule"/);
});
