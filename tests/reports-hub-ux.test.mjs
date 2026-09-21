// Reports-хаб (/staff/reports): усі підзвіти виявлювані з хаба, є підказка про
// незастосовані зміни, і клієнтська перевірка Від ≤ До. Перевірка — на рівні джерела.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = () => readFile(new URL("../app/staff/reports/page.tsx", import.meta.url), "utf8");

test("reports hub links every sub-report (discoverability)", async () => {
  const page = await read();
  for (const href of [
    "/staff/reports/utilization",
    "/staff/reports/receivables",
    "/staff/reports/registers",
    "/staff/reports/material-margin",
    "/staff/reports/material-consumption-control",
    "/staff/reports/seo",
  ]) {
    assert.match(page, new RegExp(`href:"${href.replace(/\//g, "\\/")}"`), `посилання на ${href}`);
  }
  assert.match(page, /className="otherReports" aria-label="Інші звіти"/);
});

test("reports hub warns about unapplied filter/template changes", async () => {
  const page = await read();
  assert.match(page, /const dirty = Boolean\(data && appliedQuery && queryString\(\) !== appliedQuery\)/);
  assert.match(page, /className="reportDirtyHint"/);
  assert.match(page, /Є незастосовані зміни/);
});

test("reports hub guards against an inverted date range on the client", async () => {
  const page = await read();
  assert.match(page, /if \(from && to && from > to\)/);
});
