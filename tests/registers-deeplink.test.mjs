// Карта регістрів (/staff/registers) deep-лінкує CTA у конкретний розділ звіту
// оборотів, а /staff/reports/registers читає ?section=… й преселектить його.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const readMap = () => readFile(new URL("../app/staff/registers/page.tsx", import.meta.url), "utf8");
const readReport = () => readFile(new URL("../app/staff/reports/registers/page.tsx", import.meta.url), "utf8");

test("register map CTAs deep-link to their specific report section", async () => {
  const page = await readMap();
  assert.match(page, /href:"\/staff\/reports\/registers\?section=revenue"/);
  assert.match(page, /href:"\/staff\/reports\/registers\?section=equipment"/);
  assert.match(page, /href:"\/staff\/reports\/registers\?section=staff"/);
});

test("register turnover report preselects the section from the URL", async () => {
  const page = await readReport();
  assert.match(page, /params\.get\("section"\)\|\|params\.get\("sections"\)/);
  // Only valid section keys are honored, then applied to the visible sections.
  assert.match(page, /\(allSections as string\[\]\)\.includes\(item\)/);
  assert.match(page, /if\(requested\.length\)setSections\(requested\)/);
});
