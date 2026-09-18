// Заявка не має «висіти» на «Надсилаємо…»: відповідь сервера не чекає на
// сповіщення, а клієнт має запобіжний таймаут.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("site-booking віддає відповідь, не чекаючи на розсилку сповіщень", async () => {
  const route = await read("app/api/site-booking/route.ts");
  // Сповіщення відкладено через waitUntil-хелпер…
  assert.match(route, /runAfterResponse\(/);
  // …і НЕ awaited на шляху відповіді.
  assert.doesNotMatch(route, /await\s+sendTelegramBookingNotice\(/);
  assert.doesNotMatch(route, /await\s+sendBookingEmail\(/);
  // Виклики самих сповіщень збережено.
  assert.match(route, /sendTelegramBookingNotice\(db,/);
  assert.match(route, /sendBookingEmail\(db,\s*PUBLIC_ORGANIZATION_ID/);
});

// Примітка: публічна форма більше не POST-ить у /api/site-booking — запис іде
// у месенджер (public-booking-messenger.test). Клієнтський таймаут постання
// заявки більше не актуальний. Серверний runAfterResponse-шлях (для заявок,
// які створює персонал через API) лишається під тестом вище.

test("контекст виконання прокинуто в globalThis у воркері", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /__RADIOLOGY_CTX__/);
});
