import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("manager monitor stylesheet loads after the core workspace design system", async () => {
  const globals = await read("app/globals.css");
  const core = globals.indexOf('@import "./styles/12-design-system.css";');
  const monitor = globals.indexOf('@import "./styles/13-dashboard-monitor.css";');
  assert.notEqual(core, -1);
  assert.notEqual(monitor, -1);
  assert.ok(monitor > core);
});

test("dashboard monitor preserves the existing action-first hierarchy", async () => {
  const [page, css] = await Promise.all([
    read("app/staff/dashboard/page.tsx"),
    read("app/styles/13-dashboard-monitor.css"),
  ]);

  assert.match(page, /className="dashMc"/);
  assert.match(page, /className="dashTier t1"/);
  assert.match(page, /id="dash-pending"/);
  assert.match(page, /id="dash-agenda"/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.dashNeedsCall/);
  assert.match(css, /\.dashAgendaRow:hover/);
  assert.match(css, /prefers-reduced-motion/);
});
