// /staff/book (запис реєстратором) — зріла форма: усі поля обгорнуті в
// <label><span>, resilience у loadRefs/submit, role=alert/status, todayInKyiv()
// як min дати запису, пошук найближчого слоту, контраст-алерт із CRM. Єдина
// data-quality знахідка: інпут дати народження мав max="2100-12-31" (дозволяв
// неможливу майбутню ДН). Звужено до todayInKyiv() — клієнтський guard, не
// бізнес-логіка; сервер валідацію зберігає.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/staff/book/page.tsx", import.meta.url), "utf8");

test("book DOB input cannot pick a future date (max=todayInKyiv)", () => {
  assert.match(page, /name="dob" type="date" max=\{todayInKyiv\(\)\} min="1920-01-01"/);
  assert.doesNotMatch(page, /name="dob"[^>]*max="2100-12-31"/);
});

test("book form fields stay labelled and resilient (regression guard)", () => {
  // Усі основні поля — через <label><span>; помилки/успіх мають ролі.
  assert.match(page, /<label className="settingsField"><span>Прізвище/);
  assert.match(page, /className="notice error" role="alert"/);
  assert.match(page, /className="notice success" role="status"/);
});
