import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEPARTMENT_STRUCTURE as S } from "../lib/department-structure.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("structure data covers hospital, license, rooms, equipment and hours", () => {
  assert.match(S.hospital.unit, /А3120/);
  assert.equal(S.hospital.edrpou, "08296098");
  assert.match(S.license.number, /ОВ 011260/);
  assert.equal(S.license.validUntil, "08.11.2027");
  // Усі 9 апаратів ліцензії присутні (по кабінетах).
  const devices = S.rooms.flatMap((r) => r.devices.map((d) => d.name));
  assert.equal(devices.length, 9);
  for (const name of ["SOMATOM AR-TX", "Somatom go.Up", "SHIMADZU UD 150L-30EX", "SERISCOP CX",
    "9Л5", "PLX 102", "М32", "WHA-50N Opescope", "Серикс-71"]) {
    assert.ok(devices.some((d) => d.includes(name)), `device ${name} present`);
  }
  // Режим роботи — амбулаторні і стаціонарні.
  assert.equal(S.hours.outpatient.rows.length, 2);
  assert.equal(S.hours.inpatient.rows.length, 2);
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
  assert.match(page, /\/api\/staff\/org-profile/); // гейт доступу
  assert.match(page, /Захищений розділ/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href="\/staff\/structure"/);
  assert.match(shell, /Структура відділення/);
});
