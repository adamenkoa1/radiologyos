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

// Примітка: публічна форма більше не має селектора каналу — запис іде прямо в
// месенджер (див. public-booking-messenger.test). Механізм [contact:x]
// лишається для заявок, які реєстратор оформлює вручну (сервер/notify/telegram).
