import assert from "node:assert/strict";
import test from "node:test";
import { workCalendar, holidaysForYear, hasHolidayData } from "../lib/work-calendar.ts";

test("2026 norm calendar without holidays matches the reference 1C production calendar", () => {
  const cal = workCalendar(2026, { includeHolidays: false });
  assert.deepEqual(cal.months.map((m) => m.workingDays), [22, 20, 22, 22, 21, 22, 23, 21, 22, 22, 21, 23]);
  assert.deepEqual(cal.months.map((m) => m.hours), [176, 160, 176, 176, 168, 176, 184, 168, 176, 176, 168, 184]);
  assert.equal(cal.totalDays, 261);
  assert.equal(cal.totalHours, 2088);
  assert.equal(cal.avgMonthlyHours, 174);
});

test("2026 with Ukrainian holidays gives the legally-correct lower norm", () => {
  const cal = workCalendar(2026, { includeHolidays: true });
  // Five holidays fall on weekdays (1 Jan, 1 May, 24 Aug, 1 Oct, 25 Dec) → -5 days.
  assert.equal(cal.totalDays, 256);
  assert.equal(cal.totalHours, 2048);
  assert.equal(cal.months[0].workingDays, 21); // Січень: 22 - Новий рік
  assert.equal(cal.months[0].holidays, 1);
  assert.equal(cal.months[1].holidays, 0); // Лютий: свят немає
});

test("custom hours per day scale the norm", () => {
  const cal = workCalendar(2026, { includeHolidays: false, hoursPerDay: 7 });
  assert.equal(cal.totalHours, 261 * 7);
  assert.equal(cal.months[0].hours, 22 * 7);
});

test("holiday data is exposed and years without data degrade gracefully", () => {
  assert.equal(hasHolidayData(2026), true);
  assert.equal(holidaysForYear(2026).length, 10);
  assert.equal(hasHolidayData(2099), false);
  // No holiday data → includeHolidays has no effect, pure five-day norm.
  const a = workCalendar(2099, { includeHolidays: true });
  const b = workCalendar(2099, { includeHolidays: false });
  assert.equal(a.totalDays, b.totalDays);
});
