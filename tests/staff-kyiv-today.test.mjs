// «Сьогодні» для вибору/підсвітки календарного дня має бути клінічним днем
// (Europe/Kyiv), а не UTC. Інакше вночі 00:00–03:00 за Києвом
// `new Date().toISOString().slice(0,10)` повертає вчорашню дату, і персонал
// бачить попередній день як дефолт/підсвічене «сьогодні».

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("shift table highlights today by the clinic (Kyiv) day, not UTC", async () => {
  const page = await read("app/staff/shifts/page.tsx");
  assert.match(page, /import \{ todayInKyiv \} from "\.\.\/\.\.\/\.\.\/lib\/booking-rules"/);
  assert.match(page, /const today = todayInKyiv\(\);/);
  assert.doesNotMatch(page, /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/);
});

test("schedule defaults the selected day to the clinic (Kyiv) day, not UTC", async () => {
  const page = await read("app/staff/schedule/page.tsx");
  assert.match(page, /import \{ todayInKyiv \} from "\.\.\/\.\.\/\.\.\/lib\/booking-rules"/);
  assert.match(page, /useState\(\(\) => todayInKyiv\(\)\)/);
  assert.doesNotMatch(page, /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/);
});

test("personnel schedule 'valid from' defaults to the clinic (Kyiv) day, not UTC", async () => {
  const page = await read("app/staff/personnel/page.tsx");
  assert.match(page, /import \{ todayInKyiv \} from "\.\.\/\.\.\/\.\.\/lib\/booking-rules"/);
  assert.match(page, /defaultValue=\{scheduleEditor\?\.validFrom \|\| todayInKyiv\(\)\}/);
});
