import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("tab title leads with the brand (so it does not truncate to «Пром»)", async () => {
  const layout = await read("app/layout.tsx");
  assert.match(layout, /title:\s*"RadiologyOS/);
});

test("favicon is the RadiologyOS mark, not the placeholder blue blocks", async () => {
  const svg = await read("public/favicon.svg");
  assert.match(svg, /#25b4c0/); // фірмовий бірюзовий гліф
  assert.doesNotMatch(svg, /#68C4FF|#0C79D8/); // прибрано типову блакитну заглушку
});

test("patient-card link sits on its own line (not glued to the phone)", async () => {
  const css = await read("app/globals.css");
  assert.match(css, /\.crmCardLink\{display:block;margin-top:6px/);
});

test("staff member rows keep min column widths so selects don't truncate", async () => {
  const css = await read("app/globals.css");
  assert.match(css, /\.staffMemberList form\{grid-template-columns:minmax\(/);
});
