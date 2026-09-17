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

test("клієнтський postBooking має таймаут, щоб кнопка не зависла назавжди", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /AbortController/);
  assert.match(bridge, /signal:/);
  assert.match(bridge, /clearTimeout/);
  // Той самий idempotency-key зберігається (безпечне повторне надсилання).
  assert.match(bridge, /idempotency-key/);
});

test("контекст виконання прокинуто в globalThis у воркері", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /__RADIOLOGY_CTX__/);
});
