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
  for (const name of ["Siemens SOMATOM go.Up", "Sireskop-CX", "5Д2", "HYPERION X9 Pro", "RXDC",
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
  assert.equal(totalStudies2025(S), 29700);
  assert.equal(S.statistics2025.breakdown.length, 3);
  assert.equal(S.statistics2025.breakdown.find((item) => item.id === "fluorograms")?.value, 16500);
  assert.equal(S.statistics2025.breakdown.find((item) => item.id === "radiographs")?.value, 10400);
  assert.equal(S.statistics2025.breakdown.find((item) => item.id === "ct")?.value, 2800);
  assert.equal(S.statistics2025.complexShare, 45);
});

test("legacy 2025 defaults migrate to the agreed radiology-only totals", () => {
  const changed = sanitizeDepartmentStructure({
    statistics2025: {
      ...S.statistics2025,
      breakdown: [
        { id: "copies", label: "Скопій", value: 590 },
        { id: "radiographs", label: "Рентгенографій", value: 10444 },
        { id: "fluorograms", label: "Флюорограм", value: 16513 },
        { id: "ct", label: "Комп’ютерних томографій", value: 2861 },
        { id: "ultrasound", label: "УЗД", value: 9406 },
      ],
    },
  });
  assert.equal(totalStudies2025(changed), 29700);
  assert.deepEqual(changed.statistics2025.breakdown, S.statistics2025.breakdown);
});

test("legacy broad 24/7 wording migrates to emergency studies only", () => {
  const changed = sanitizeDepartmentStructure({
    department: {
      ...S.department,
      emergency: "Для військовослужбовців відділення працює цілодобово — 24/7",
    },
  });
  assert.equal(changed.department.emergency, S.department.emergency);
  assert.match(changed.department.emergency, /Екстрені дослідження/);
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
  // Ще й додаткові прізвища/адреси з відомості 2024 — теж відсутні.
  assert.doesNotMatch(raw, /БЕНДІК|ВОВКУШЕВСЬКИЙ|КРИВЦОВ|КОВАЛЕНКО/);
  assert.doesNotMatch(raw, /Незалежності 25|Савчук|Масанівська|П['’]ятницька/);
});

test("personnel roster is posts-and-headcount only (real posts, 9 people)", () => {
  const positions = S.personnel.map((p) => p.position);
  assert.ok(positions.includes("Молодша медична сестра"));
  assert.ok(positions.includes("Водій-електрик ПРК"));
  assert.ok(!positions.includes("Лікарі-рентгенологи")); // немає у фактичній відомості
  const total = S.personnel.reduce((n, p) => n + (Number((p.note.match(/^\d+/) || [])[0]) || 0), 0);
  assert.equal(total, 9);
});

test("legacy generic personnel list migrates to the real posts; custom lists untouched", () => {
  const migrated = sanitizeDepartmentStructure({
    personnel: [
      { position: "Начальник відділення променевої діагностики", note: "Відповідальна особа з радіаційної безпеки" },
      { position: "Начальник ПРК", note: "" },
      { position: "Лікарі-рентгенологи", note: "" },
      { position: "Рентгенолаборанти", note: "" },
    ],
  });
  assert.deepEqual(migrated.personnel, S.personnel);
  const custom = sanitizeDepartmentStructure({ personnel: [{ position: "Фізик-дозиметрист", note: "1" }] });
  assert.equal(custom.personnel.length, 1);
  assert.equal(custom.personnel[0].position, "Фізик-дозиметрист");
});

test("structure page is staff-gated and wired into the shell nav", async () => {
  const page = await read("app/staff/structure/page.tsx");
  assert.match(page, /active="structure"/);
  assert.match(page, /\/api\/staff\/structure/); // гейт і єдине джерело даних
  assert.match(page, /Захищений розділ/);
  assert.match(page, /Редагуйте текст прямо на макеті/);
  assert.match(page, /Службова структура відділення/);
  assert.match(page, /href="\/staff\/tariffs"/);
  assert.doesNotMatch(page, /type="file"|onLogoFile/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href="\/staff\/structure"/);
  assert.match(shell, /Публічна вітрина/);
});
