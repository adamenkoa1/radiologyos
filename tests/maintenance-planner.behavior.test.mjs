// Планувальник ТО: forward-looking групування активних датованих записів
// обслуговування за горизонтом строку. Чисті правила + проводка сторінки.
// Жодного нового API чи міграції — подання поверх наявного журналу ТО.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  daysUntil, maintenanceBucket, isPlannerEvent, bucketMaintenance, upcomingCount,
  MAINTENANCE_BUCKET_ORDER,
} from "../lib/maintenance-planner.ts";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("daysUntil computes whole-day deltas and rejects bad dates", () => {
  assert.equal(daysUntil("2026-10-30", "2026-10-30"), 0);
  assert.equal(daysUntil("2026-10-30", "2026-11-06"), 7);
  assert.equal(daysUntil("2026-10-30", "2026-10-25"), -5);
  assert.equal(daysUntil("2026-10-30", ""), null);
  assert.equal(daysUntil("", "2026-10-30"), null);
  assert.equal(daysUntil("2026-10-30", "30.10.2026"), null);
});

test("maintenanceBucket maps a due date to the right horizon (with boundaries)", () => {
  const t = "2026-10-30";
  assert.equal(maintenanceBucket(t, "2026-10-29"), "overdue");
  assert.equal(maintenanceBucket(t, "2026-10-30"), "today");
  assert.equal(maintenanceBucket(t, "2026-10-31"), "week");   // +1
  assert.equal(maintenanceBucket(t, "2026-11-06"), "week");   // +7 boundary
  assert.equal(maintenanceBucket(t, "2026-11-07"), "month");  // +8
  assert.equal(maintenanceBucket(t, "2026-11-29"), "month");  // +30 boundary
  assert.equal(maintenanceBucket(t, "2026-11-30"), "later");  // +31
  assert.equal(maintenanceBucket(t, ""), null);
});

test("only active, dated events belong to the planner", () => {
  assert.equal(isPlannerEvent({ status:"open", dueDate:"2026-11-01" }), true);
  assert.equal(isPlannerEvent({ status:"in_progress", dueDate:"2026-11-01" }), true);
  assert.equal(isPlannerEvent({ status:"open", dueDate:"" }), false);
  assert.equal(isPlannerEvent({ status:"done", dueDate:"2026-11-01" }), false);
  assert.equal(isPlannerEvent({ status:"cancelled", dueDate:"2026-11-01" }), false);
});

test("bucketMaintenance groups, excludes non-planner, sorts within a bucket, keeps order, omits empty", () => {
  const today = "2026-10-30";
  const events = [
    { id:1, status:"open", dueDate:"2026-11-20" },        // month
    { id:2, status:"open", dueDate:"2026-10-20" },        // overdue
    { id:3, status:"in_progress", dueDate:"2026-11-02" }, // week
    { id:4, status:"open", dueDate:"2026-11-04" },        // week
    { id:5, status:"done", dueDate:"2026-11-01" },        // excluded (done)
    { id:6, status:"open", dueDate:"" },                   // excluded (no date)
    { id:7, status:"open", dueDate:"2026-10-30" },        // today
  ];
  const groups = bucketMaintenance(events, today);
  const order = groups.map((g) => g.bucket);
  assert.deepEqual(order, ["overdue", "today", "week", "month"], "buckets in canonical order, 'later' omitted (empty)");
  const week = groups.find((g) => g.bucket === "week");
  assert.deepEqual(week.items.map((x) => x.id), [3, 4], "week sorted ascending by due date");
  // виключені записи ніде не зʼявляються
  const allIds = groups.flatMap((g) => g.items.map((x) => x.id));
  assert.ok(!allIds.includes(5) && !allIds.includes(6));
});

test("upcomingCount counts active dated events within [0..days] inclusive", () => {
  const today = "2026-10-30";
  const events = [
    { status:"open", dueDate:"2026-10-29" },       // overdue → excluded
    { status:"open", dueDate:"2026-10-30" },       // 0 → in
    { status:"in_progress", dueDate:"2026-11-06" },// 7 → in
    { status:"open", dueDate:"2026-11-07" },       // 8 → out (for days=7)
    { status:"done", dueDate:"2026-11-01" },       // done → excluded
  ];
  assert.equal(upcomingCount(events, today, 7), 2);
});

test("bucket order constant is the canonical five", () => {
  assert.deepEqual(MAINTENANCE_BUCKET_ORDER, ["overdue", "today", "week", "month", "later"]);
});

test("maintenance page wires the planner view over existing data (no new API)", async () => {
  const page = await read("app/staff/maintenance/page.tsx");
  assert.match(page, /import \{ bucketMaintenance, upcomingCount \} from "\.\.\/\.\.\/\.\.\/lib\/maintenance-planner"/);
  // новий фільтр «Планувальник» + KPI «Найближчі 7 днів»
  assert.match(page, /"planner"/);
  assert.match(page, /Планувальник/);
  assert.match(page, /Найближчі 7 днів/);
  assert.match(page, /upcomingCount\(data\?\.events\|\|\[\],today,7\)/);
  // згрупований рендер використовує спільний рендер картки `card`
  assert.match(page, /plannerGroups=bucketMaintenance\(data\?\.events\|\|\[\],today\)/);
  assert.match(page, /g\.items\.map\(card\)/);
  assert.match(page, /rows\.map\(card\)/);
  // планувальник не додає нового звернення до API (той самий /api/staff/maintenance GET)
  assert.doesNotMatch(page, /\/api\/staff\/maintenance\/planner/);
});
