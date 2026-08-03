import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countUk, pluralUk, roleLabelUk } from "../lib/labels.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("pluralUk applies Ukrainian plural rules", () => {
  assert.equal(pluralUk(1, "апарат", "апарати", "апаратів"), "апарат");
  assert.equal(pluralUk(2, "апарат", "апарати", "апаратів"), "апарати");
  assert.equal(pluralUk(4, "апарат", "апарати", "апаратів"), "апарати");
  assert.equal(pluralUk(5, "апарат", "апарати", "апаратів"), "апаратів");
  assert.equal(pluralUk(0, "апарат", "апарати", "апаратів"), "апаратів");
  assert.equal(pluralUk(11, "апарат", "апарати", "апаратів"), "апаратів"); // виняток 11-14
  assert.equal(pluralUk(21, "апарат", "апарати", "апаратів"), "апарат");
  assert.equal(pluralUk(22, "апарат", "апарати", "апаратів"), "апарати");
  assert.equal(countUk(3, "серія", "серії", "серій"), "3 серії");
});

test("roleLabelUk maps roles and passes through unknowns", () => {
  assert.equal(roleLabelUk("admin"), "Адміністратор");
  assert.equal(roleLabelUk("registrar"), "Реєстратор");
  assert.equal(roleLabelUk("radiologist"), "Лікар-рентгенолог");
  assert.equal(roleLabelUk(undefined), undefined);
  assert.equal(roleLabelUk("weird"), "weird");
});

test("remaining staff pages use the shared role label (no raw enum to the shell)", async () => {
  for (const page of ["tariffs", "services", "equipment", "schedule", "chat", "whatsapp", "organization", "audit"]) {
    const src = await read(`app/staff/${page}/page.tsx`);
    assert.match(src, /roleLabelUk\(/, `${page} maps role`);
  }
});

test("cabinet/finance pages guard loading and admin-only edits", async () => {
  const tariffs = await read("app/staff/tariffs/page.tsx");
  assert.match(tariffs, /Завантаження тарифів/);
  assert.match(tariffs, /Тарифів не знайдено/);
  const tariffRoute = await read("app/api/staff/tariffs/route.ts");
  assert.match(tariffRoute, /db\.batch\(statements\)/); // all-or-nothing save
  const equipment = await read("app/staff/equipment/page.tsx");
  assert.match(equipment, /disabled=\{!canEdit\}/); // non-admin read-only
  const reports = await read("app/staff/reports/page.tsx");
  assert.match(reports, /appliedQuery/); // export matches what is shown
});
