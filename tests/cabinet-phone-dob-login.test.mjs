// Вхід у кабінет за телефоном + датою народження (без обов'язкового номера
// заявки). Номер заявки лишається запасним і зʼявляється лише коли сервер
// повідомляє про неоднозначність (кілька записів на телефон+ДН).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("cabinet no longer requires the booking code to log in", async () => {
  const cabinet = await read("public/site/cabinet.html");
  // Поле номера заявки приховане за замовчуванням.
  assert.match(cabinet, /id="codeField"[^>]*hidden/);
  // Вхід більше не блокується відсутністю коду.
  assert.doesNotMatch(cabinet, /Вкажіть номер заявки \(RD-…\)/);
  // Логін шле телефон+ДН, а код — лише якщо введений.
  assert.match(cabinet, /const bodyObj=\{phone:'\+380'\+digits,dob\};if\(code\)bodyObj\.bookingCode=code/);
  // На 409 (неоднозначно) розкриваємо поле коду.
  assert.match(cabinet, /res\.status===409&&data\.needBookingCode/);
  assert.match(cabinet, /getElementById\('codeField'\)\.hidden=false/);
});

test("patient-login accepts phone+DOB and stays fail-closed on ambiguity", async () => {
  const route = await read("app/api/patient-login/route.ts");
  // Обов'язкові лише телефон і ДН.
  assert.match(route, /if \(!phoneNormalized \|\| !dob\)/);
  // Шлях без коду використовує спільну перевірку та повертає needBookingCode при
  // неоднозначності (замість входу в довільний запис).
  assert.match(route, /provePatientDobIdentity\(db, PRIMARY_ORGANIZATION_ID, phoneNormalized, dob\)/);
  assert.match(route, /proof\.status === "ambiguous"/);
  assert.match(route, /needBookingCode: true/);
  assert.match(route, /\{ kind: "dob", value: dob \}/);
});

test("dob identity proof is shared between login and OTP (no drift)", async () => {
  const otp = await read("app/api/patient-otp/route.ts");
  assert.match(otp, /provePatientDobIdentity\(db, PRIMARY_ORGANIZATION_ID, phoneNormalized, dob\)/);
  const lib = await read("lib/patient-identity.ts");
  assert.match(lib, /export async function provePatientDobIdentity/);
  // Один незмінний пацієнт або єдиний легасі-запис → ok; решта → ambiguous.
  assert.match(lib, /status: "ambiguous"/);
  assert.match(lib, /total === 1 && linkedCount === 0/);
});
