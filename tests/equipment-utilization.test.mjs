// Завантаженість обладнання — чиста логіка потужності/простою.

import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyCapacityMinutes, datesInRange, utilizationRow, summarizeUtilization,
} from "../lib/equipment-utilization.ts";

test("dailyCapacityMinutes = вікно мінус обід у межах вікна", () => {
  assert.equal(dailyCapacityMinutes({ start: "08:00", end: "17:00", breakStart: "13:00", breakEnd: "14:00" }), 480);
  assert.equal(dailyCapacityMinutes({ start: "10:00", end: "15:00", breakStart: "13:00", breakEnd: "14:00" }), 240);
  assert.equal(dailyCapacityMinutes({ start: "09:30", end: "16:00", breakStart: "13:00", breakEnd: "14:00" }), 330);
  assert.equal(dailyCapacityMinutes({ start: "08:00", end: "17:00" }), 540); // без обіду
  assert.equal(dailyCapacityMinutes({ start: "08:00", end: "17:00", breakStart: "18:00", breakEnd: "19:00" }), 540); // обід поза вікном ігнорується
  assert.equal(dailyCapacityMinutes({ start: "17:00", end: "08:00" }), 0); // некоректне вікно
});

test("datesInRange повертає всі дати включно, порожньо на некоректних", () => {
  assert.deepEqual(datesInRange("2026-07-13", "2026-07-15"), ["2026-07-13", "2026-07-14", "2026-07-15"]);
  assert.equal(datesInRange("2026-07-13", "2026-07-19").length, 7);
  assert.deepEqual(datesInRange("2026-07-15", "2026-07-13"), []); // from > to
  assert.deepEqual(datesInRange("bad", "2026-07-13"), []);
});

test("utilizationRow рахує потужність, завантаження, простій", () => {
  const r = utilizationRow({
    equipmentId: "ct", label: "КТ", workingDays: 6, dailyCapacityMinutes: 480,
    performedMinutes: 720, performedCount: 16, bookedMinutes: 960,
  });
  assert.equal(r.capacityMinutes, 2880); // 6 × 480
  assert.equal(r.utilizationPct, 25);    // 720/2880
  assert.equal(r.bookedPct, 33.3);       // 960/2880 → 33.333 → 33.3
  assert.equal(r.idleMinutes, 2160);     // 2880 − 720
});

test("utilizationRow: нульова потужність не ділить на нуль", () => {
  const r = utilizationRow({ equipmentId: "x", label: "X", workingDays: 0, dailyCapacityMinutes: 480, performedMinutes: 0, performedCount: 0, bookedMinutes: 0 });
  assert.equal(r.capacityMinutes, 0);
  assert.equal(r.utilizationPct, 0);
  assert.equal(r.idleMinutes, 0);
});

test("summarizeUtilization підсумовує та бере максимум робочих днів", () => {
  const rows = [
    utilizationRow({ equipmentId: "ct", label: "КТ", workingDays: 6, dailyCapacityMinutes: 480, performedMinutes: 480, performedCount: 10, bookedMinutes: 600 }),
    utilizationRow({ equipmentId: "xray", label: "Рентген", workingDays: 6, dailyCapacityMinutes: 240, performedMinutes: 240, performedCount: 12, bookedMinutes: 240 }),
  ];
  const t = summarizeUtilization(rows);
  assert.equal(t.capacityMinutes, 2880 + 1440);
  assert.equal(t.performedMinutes, 720);
  assert.equal(t.performedCount, 22);
  assert.equal(t.workingDays, 6);
  assert.equal(t.idleMinutes, (2880 + 1440) - 720);
});
