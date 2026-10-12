// Наскрізний клавіатурний фокус (WCAG 2.4.7) для всього staff-контуру: кастомні
// кнопки/лінки/summary на багатьох staff-сторінках не мали видимого focus-ring.
// Замість page-by-page — єдине baseline-правило, scoped до .workspaceShell (усі
// staff-сторінки рендеряться в ньому через StaffWorkspaceShell), яке спрацьовує
// лише при клавіатурній навігації (:focus-visible). Інпути/селекти/textarea вже
// мають власний box-shadow-фокус у 01-base.css, тож у baseline не включені.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("staff shell has a global keyboard focus-ring baseline for buttons/links/summary", () => {
  const css = read("app/styles/02-workspace.css");
  assert.match(
    css,
    /\.workspaceShell :is\(button, a\[href\], summary\):focus-visible\s*\{\s*outline: 2px solid var\(--ws-accent\);\s*outline-offset: 2px;\s*\}/,
  );
});

test("staff shell wrapper really carries the workspaceShell class the baseline targets", () => {
  const shell = read("app/staff/workspace-shell.tsx");
  assert.match(shell, /className=\{`workspaceShell basWorkspaceShell/);
});

test("the focus baseline does not reshape controls (no border-radius override on focus)", () => {
  const css = read("app/styles/02-workspace.css");
  // Правило фокусу не повинно містити border-radius (інакше pill-кнопки
  // змінювали б форму при фокусі).
  assert.doesNotMatch(
    css,
    /:focus-visible\s*\{[^}]*outline: 2px solid var\(--ws-accent\)[^}]*border-radius/,
  );
});
