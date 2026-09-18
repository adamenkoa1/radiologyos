import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("resource planner styles load after dashboard and core design layers", async () => {
  const globals = await read("app/globals.css");
  const dashboard = globals.indexOf('@import "./styles/13-dashboard-monitor.css";');
  const planner = globals.indexOf('@import "./styles/14-resource-planner.css";');
  assert.notEqual(dashboard, -1);
  assert.notEqual(planner, -1);
  assert.ok(planner > dashboard);
});

test("resource planner keeps the existing equipment-first calendar contract", async () => {
  const [calendar, css] = await Promise.all([
    read("app/staff/week-calendar.tsx"),
    read("app/styles/14-resource-planner.css"),
  ]);
  assert.match(calendar, /className="roomSlotBoard"/);
  assert.match(calendar, /EQUIP_KEYS\.map/);
  assert.match(calendar, /className="apptWeek"/);
  assert.match(calendar, /className="apptViewToggle"/);
  assert.match(css, /\.roomSlotColumns/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.roomSlot\.free/);
  assert.match(css, /\.roomSlot\.occupied/);
  assert.match(css, /\.apptNowLine/);
  assert.match(css, /prefers-reduced-motion/);
});
