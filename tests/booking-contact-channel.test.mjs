// Пацієнт обирає канал зв'язку (Viber/WhatsApp/Telegram). Заявка приходить
// реєстратору в Telegram із зазначеним каналом+телефоном, а дошка прийому дає
// пряме посилання відкрити чат у цьому месенджері.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("preferredContactFromComment reads the [contact:x] prefix incl. Telegram", async () => {
  const lib = await read("lib/notify.ts");
  // Префікс-парсер і роутер каналів мають знати про Telegram.
  assert.match(lib, /contact:\(call\|whatsapp\|email\|viber\|telegram\)/);
  assert.match(lib, /preferred === "telegram" \? channel === "telegram"/);
  assert.match(lib, /"viber" \| "telegram"/);
});

test("the registrar's Telegram notice carries the phone and chosen channel", async () => {
  const lib = await read("lib/telegram.ts");
  assert.match(lib, /contactLine\(notice\.phone, notice\.contactMethod\)/);
  // WhatsApp дає пряме https-посилання (Telegram робить його тапабельним).
  assert.match(lib, /https:\/\/wa\.me\/\$\{digits\}/);
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /phone,contactMethod,/); // передається у нотіфікацію
  assert.match(route, /CONTACT_METHODS = \["call", "viber", "whatsapp", "telegram"\]/);
  assert.match(route, /\[contact:\$\{contactMethod\}\]/);
});

test("intake gives a one-tap link for manual messengers and shows the chosen channel", async () => {
  const page = await read("app/staff/intake/page.tsx");
  // Viber і Telegram — прямі app-лінки (гейтвею для ручного відкриття немає).
  assert.match(page, /contact === "telegram"[\s\S]*tg:\/\/resolve\?phone=/);
  assert.match(page, /contact === "viber"[\s\S]*viber:\/\/chat/);
  // WhatsApp свідомо БЕЗ прямого wa.me на staff-сторінці (контрольований канал
  // /api/staff/notify поважає «не турбувати»); канал видно чіпом.
  assert.doesNotMatch(page, /wa\.me/);
  assert.match(page, /telegram:"Telegram"/);
  assert.match(page, /\{CONTACT_LABELS\[contact\]\}/);
});

test("all booking forms offer the contact-channel selector", async () => {
  for (const [page, id] of [
    ["public/site/index.html", "patientContact"],
    ["public/site/price.html", "patientContact"],
    ["public/site/military.html", "militaryPatientContact"],
  ]) {
    const html = await read(page);
    assert.match(html, new RegExp(`id="${id}"`), `${page}: селектор`);
    for (const v of ["viber", "whatsapp", "telegram"]) {
      assert.match(html, new RegExp(`value="${v}"`), `${page}: ${v}`);
    }
  }
});
