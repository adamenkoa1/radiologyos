// Консистентність a11y (WCAG 4.1.3 Status Messages): кожен плейсхолдер
// завантаження .dashLoading на staff-сторінках має оголошуватися скрінрідером
// (role="status" aria-live). Раніше частина сторінок (structure, profile, audit,
// reports, organization) мала «голий» <p className="dashLoading">, тож поява
// даних не повідомлялася. Гард тримає інваріант по всьому staff-контуру.

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";

const STAFF = "app/staff";
const pages = readdirSync(STAFF, { recursive: true })
  .filter((p) => String(p).endsWith("page.tsx"))
  .map((p) => `${STAFF}/${p}`);

test("every staff dashLoading placeholder is announced as a status", () => {
  const offenders = [];
  for (const file of pages) {
    const src = readFileSync(file, "utf8");
    // «голий» className="dashLoading"> (без role/aria-live одразу після класу)
    if (/className="dashLoading">/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'ці .dashLoading без role="status" aria-live');
});
