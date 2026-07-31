import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEPARTMENT_STRUCTURE as S,
  sanitizeDepartmentStructure,
  totalStudies2025,
} from "../lib/department-structure.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("structure data covers hospital, license, rooms, equipment and hours", () => {
  assert.match(S.hospital.unit, /А3120/);
  assert.equal(S.hospital.edrpou, "08296098");
  assert.match(S.license.number, /ОВ 011260/);
  assert.equal(S.license.validUntil, "08.11.2027");
  const devices = S.rooms.flatMap((r) => r.devices);
  const activeDevices = devices.filter((d) => d.status !== "stored").map((d) => d.name);
  const storedDevices = devices.filter((d) => d.status === "stored").map((d) => d.name);
  assert.equal(activeDevices.length, 10);
  for (const name of ["SOMATOM go.Up", "Sireskop-CX", "5Д2", "HYPERION X9 Pro", "RXDC",
    "IMAX 6000", "12Ф9-Україна", "9Л5Ф", "PLX 102", "М32"]) {
    assert.ok(activeDevices.some((d) => d.includes(name)), `active device ${name} present`);
  }
  for (const name of ["SHIMADZU UD 150L-30EX", "12Ф7Ц"]) {
    assert.ok(storedDevices.some((d) => d.includes(name)), `stored device ${name} present`);
  }
  for (const name of ["SOMATOM AR-TX", "Серикс-71", "WHA-50N Opescope"]) {
    assert.ok(!devices.some((d) => d.name.includes(name)), `unconfirmed device ${name} absent`);
  }
  assert.ok(devices.every((d) => !("kv" in d)), "unverified kV values are not published");
  // Режим роботи — амбулаторні і стаціонарні.
  assert.equal(S.hours.outpatient.rows.length, 2);
  assert.equal(S.hours.inpatient.rows.length, 2);
  assert.equal(totalStudies2025(S), 39814);
  assert.equal(S.statistics2025.breakdown.find((item) => item.id === "ct")?.value, 2861);
  assert.equal(S.statistics2025.complexShare, 45);
});

test("structure content is editable, sanitized and persisted with public site text", async () => {
  const changed = sanitizeDepartmentStructure({ statistics2025: { ...S.statistics2025, complexShare: 999 } });
  assert.equal(changed.statistics2025.complexShare, 100);
  const route = await read("app/api/staff/structure/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(route, /DEPARTMENT_STRUCTURE_KEY/);
  assert.match(route, /SITE_CONTENT_KEY/);
  assert.match(route, /Promise\.all/);
});

test("structure carries NO personal data (no names/addresses/DOB/phones)", async () => {
  const raw = await read("lib/department-structure.ts");
  // Персонал — лише посади, без ПІБ.
  assert.doesNotMatch(raw, /ЖОЛУДЄВА|ДОНЕЦЬ|МИЛЬКО|БОБРО/); // прізвища з документів
  assert.doesNotMatch(raw, /\b0\d{9}\b/); // телефони персоналу
  assert.doesNotMatch(raw, /вул\. Бєлова|вул\. Гагаріна|Лук['’]яненка/); // домашні адреси
  for (const p of S.personnel) assert.ok(p.position && !/[А-ЯІЇЄ]{4,}\s+[А-ЯІЇЄ][а-яіїє]/.test(p.position));
});

test("structure page is staff-gated and wired into the shell nav", async () => {
  const page = await read("app/staff/structure/page.tsx");
  assert.match(page, /active="structure"/);
  assert.match(page, /\/api\/staff\/structure/); // гейт і єдине джерело даних
  assert.match(page, /Захищений розділ/);
  assert.match(page, /Редагувати структуру/);
  assert.match(page, /type="file"/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href="\/staff\/structure"/);
  assert.match(shell, /Структура відділення/);
});
