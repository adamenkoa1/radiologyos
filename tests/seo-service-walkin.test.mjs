// SEO-лендінги: дослідження «живої черги» (флюорографія, рентгенографія) явно
// кажуть, що можна прийти без запису; КТ і барій — тільки за попереднім записом
// (поле walkIn відсутнє). Головна вже описує ці правила — лендінг тепер їх не
// приховує, тож пацієнта не женуть у зайвий онлайн-запис.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only walk-in services (fluorography, x-ray) carry a walkIn note", async () => {
  const defs = await read("lib/seo-service-pages.ts");
  // Флюорографія — до 12:00 (ВЛК); рентген — робочі дні.
  assert.match(defs, /walkIn: \{ schedule: "у робочі дні до 12:00 \(зокрема для проходження ВЛК\)" \}/);
  assert.match(defs, /walkIn: \{ schedule: "у робочі дні \(рентгенографія кісток і суглобів — після 13:00\)" \}/);
  // Рівно два дослідження живої черги — КТ і барій лишаються за записом.
  const count = (defs.match(/walkIn: \{/g) || []).length;
  assert.equal(count, 2, `очікували 2 walkIn, знайдено ${count}`);
});

test("landing shows a prominent walk-in banner with address and phone", async () => {
  const component = await read("app/components/seo-service-landing.tsx");
  assert.match(component, /page\.walkIn \?/);
  assert.match(component, /Можна без запису — жива черга/);
  assert.match(component, /page\.walkIn\.schedule/);
  assert.match(component, /Направлення не потрібне/);
  assert.match(component, /м\. Чернігів, вул\. Полуботка, 40/);
  assert.match(component, /tel:\$\{CLINIC_PHONE_TEL\}/);
});
