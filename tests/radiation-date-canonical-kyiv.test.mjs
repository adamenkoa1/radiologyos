// Консистентність дат у радіаційних модулях: «сьогодні» має визначатися
// канонічно за клінічним часовим поясом (Europe/Kyiv) через todayInKyiv(), а не
// власним localIsoDate() на offset браузера (давав дату з TZ співробітника).
// Усі дефолти «станом на сьогодні» / діапазони тепер узгоджені з рештою staff
// (board/dashboard/intake уже на todayInKyiv).

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";

const DIR = "app/staff/personnel";
const pages = readdirSync(new URL(`../${DIR}`, import.meta.url), { recursive: true })
  .filter((p) => String(p).endsWith("page.tsx"))
  .map((p) => `${DIR}/${p}`);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("no personnel page reimplements a browser-offset date helper", () => {
  const offenders = pages.filter((f) => {
    const src = read(f);
    return /function localIsoDate/.test(src) || /getTimezoneOffset\(\)\s*\*\s*60_?000/.test(src);
  });
  assert.deepEqual(offenders, [], "ці сторінки мають власний localIsoDate — використайте todayInKyiv()");
});

test("radiation modules that default to today import the canonical helper", () => {
  for (const f of [
    "app/staff/personnel/radiation-review-policy/page.tsx",
    "app/staff/personnel/radiation-compliance/page.tsx",
    "app/staff/personnel/radiation-review-queue/page.tsx",
    "app/staff/personnel/radiation-dose-summary/page.tsx",
  ]) {
    assert.match(read(f), /import \{ todayInKyiv \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/booking-rules"/, f);
    assert.match(read(f), /todayInKyiv\(\)/, f);
  }
});
