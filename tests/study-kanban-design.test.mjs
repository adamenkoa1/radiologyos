import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("study Kanban is a read-only projection of the existing booking workflow", async () => {
  const page = await read("app/staff/board/page.tsx");

  assert.match(page, /fetch\("\/api\/staff\/bookings", \{ cache:"no-store" \}\)/);
  assert.doesNotMatch(page, /method\s*:\s*["']PATCH["']/);
  assert.doesNotMatch(page, /onDrop|draggable\s*=|dragstart/i);
  assert.match(page, /states:\["new","requested","needs_verification","scheduled","rescheduled","confirmed"\]/);
  assert.match(page, /states:\["arrived"\]/);
  assert.match(page, /states:\["queued","in_progress"\]/);
  assert.match(page, /states:\["performed","images_ready","reporting"\]/);
  assert.match(page, /states:\["protocol_ready","issued","completed"\]/);
});

test("study Kanban is integrated into the staff workspace and visual cascade", async () => {
  const [shell, globals, css] = await Promise.all([
    read("app/staff/workspace-shell.tsx"),
    read("app/globals.css"),
    read("app/styles/15-study-kanban.css"),
  ]);

  assert.match(shell, /"board"/);
  assert.match(shell, /href:"\/staff\/board"/);
  assert.match(shell, /active === "board"/);
  const planner = globals.indexOf('@import "./styles/14-resource-planner.css";');
  const kanban = globals.indexOf('@import "./styles/15-study-kanban.css";');
  assert.notEqual(planner, -1);
  assert.notEqual(kanban, -1);
  assert.ok(kanban > planner);
  assert.match(css, /workspaceModuleLink\[href="\/staff\/board"\]/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(245px, 1fr\)\)/);
  assert.match(css, /prefers-reduced-motion/);
});
