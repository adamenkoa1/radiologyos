// Блок замовлення (кошик): обмеження кількості послуг. Форма спрощена до
// месенджер-хендофу — перевірки самого запису див. public-booking-messenger.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("кошик обмежує кількість послуг тим самим лімітом, що й сервер", async () => {
  const cart = await read("public/site/assets/cart.js");
  const route = await read("app/api/site-booking/route.ts");
  const serverMax = route.match(/MAX_SERVICES_PER_REQUEST\s*=\s*(\d+)/);
  const clientMax = cart.match(/MAX_SERVICES_PER_REQUEST\s*=\s*(\d+)/);
  assert.ok(serverMax, "серверний ліміт знайдено");
  assert.ok(clientMax, "клієнтський ліміт знайдено");
  assert.equal(clientMax[1], serverMax[1], "ліміти мають збігатися");
  // Додавання понад ліміт блокується у addToCart, а не лише при сабміті.
  assert.match(cart, /cart\.length >= MAX_SERVICES_PER_REQUEST/);
});

test("військовий кошик теж обмежує кількість досліджень", async () => {
  const mil = await read("public/site/military.html");
  assert.match(mil, /militaryCart\.length >= 5/);
});
