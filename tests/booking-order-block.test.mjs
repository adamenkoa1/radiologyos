// Блок замовлення: кошик обмежує кількість послуг, форми збирають e-mail (щоб
// працював вхід у кабінет за кодом із листа), а клієнт передає e-mail і обраний
// слот на сервер. Статичні перевірки розмітки/скриптів — без рендера.

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

test("форми запису збирають необов'язковий e-mail", async () => {
  for (const page of ["public/site/index.html", "public/site/price.html"]) {
    const html = await read(page);
    assert.match(html, /id="patientEmail"[^>]*type="email"/, `${page}: поле e-mail`);
  }
  const mil = await read("public/site/military.html");
  assert.match(mil, /id="militaryPatientEmail"[^>]*type="email"/, "військова форма: поле e-mail");
});

test("клієнт передає e-mail і обраний слот у заявці", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  // Читання e-mail з обох форм.
  assert.match(bridge, /getElementById\('patientEmail'\)/);
  assert.match(bridge, /getElementById\('militaryPatientEmail'\)/);
  // e-mail і бажаний слот присутні у payload.
  assert.match(bridge, /name, phone, dob, email, category/);
  assert.match(bridge, /desiredDate, desiredTime/);
});

test("сервер поважає обраний слот і фіксує перевагу пацієнта", async () => {
  const route = await read("app/api/site-booking/route.ts");
  // desiredDate/desiredTime читаються й передаються у планувальник.
  assert.match(route, /preferredDate\b/);
  assert.match(route, /preferredTime\b/);
  assert.match(route, /assignEarliestAppointments\(\{[\s\S]*preferredDate,[\s\S]*preferredTime,/);
  assert.match(route, /Бажаний час пацієнта:/);
});

test("військова форма має інлайн-валідацію на blur, як цивільна", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /if \(milForm\) bindInlineValidation\(milForm\)/);
});
