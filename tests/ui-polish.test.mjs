import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("tab title identifies the public radiology department", async () => {
  const layout = await read("app/layout.tsx");
  assert.match(layout, /title:\s*"Променева діагностика \| Чернігівський військовий госпіталь/);
});

test("the public site does not declare a logo favicon", async () => {
  const layout = await read("app/layout.tsx");
  assert.doesNotMatch(layout, /hospital-emblem|icons:/);
});

test("patient-card link sits on its own line (not glued to the phone)", async () => {
  const css = await read("app/globals.css");
  assert.match(css, /\.crmCardLink\{display:block;margin-top:6px/);
});

test("staff member rows keep min column widths so selects don't truncate", async () => {
  const css = await read("app/globals.css");
  assert.match(css, /\.staffMemberList form\{grid-template-columns:minmax\(/);
});

test("public landing: sticky header masks the top gap so content doesn't bleed through", async () => {
  const html = await read("public/site/index.html");
  assert.match(html, /header::before\{content:"";position:absolute;left:0;right:0;top:-16px;height:16px;background:var\(--bg\);pointer-events:none\}/);
});
