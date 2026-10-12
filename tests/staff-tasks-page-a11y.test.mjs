// A11y/дизайн-узгодженість сторінки завдань:
//  - сегментований перемикач «В роботі/Виконані» має ARIA (role=tab/aria-selected),
//    як і фільтр на /staff/imaging — щоб скрінрідер озвучував активний стан;
//  - кастомні кнопки мають видимий фокус із клавіатури (WCAG 2.2 2.4.7);
//  - панель створення використовує бренд-токен, а не захардкоджений синій.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("tasks state filter exposes tab semantics to assistive tech", async () => {
  const page = await read("app/staff/tasks/page.tsx");
  assert.match(page, /className="taskSegments" role="tablist" aria-label="Фільтр завдань за станом"/);
  assert.match(page, /role="tab" aria-selected=\{mode==="open"\}/);
  assert.match(page, /role="tab" aria-selected=\{mode==="done"\}/);
});

test("tasks custom controls have a visible keyboard focus ring", async () => {
  const css = await read("app/styles/16-tasks.css");
  assert.match(css, /\.taskSegments button:focus-visible[\s\S]*?outline:2px solid var\(--ws-accent\)/);
});

test("tasks create panel border uses the brand accent token, not a hardcoded blue", async () => {
  const css = await read("app/styles/16-tasks.css");
  assert.match(css, /\.taskCreate \{[\s\S]*?border:1px solid color-mix\(in srgb,var\(--ws-accent\) 30%,var\(--ws-line\)\)/);
  assert.doesNotMatch(css, /rgba\(37,99,235,\.22\)/);
});
