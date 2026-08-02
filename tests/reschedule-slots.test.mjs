import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Перенесення запису по заявці має пропонувати лише реальні вільні слоти
// (як у формі для пацієнта), а не «сліпий» ввід часу.
test("staff reschedule offers real free slots from /api/availability", async () => {
  const source = await readFile(new URL("../app/staff/page.tsx", import.meta.url), "utf8");
  // Компонент існує і використовується для перенесення.
  assert.match(source, /function RescheduleForm\(/);
  assert.match(source, /<RescheduleForm\s/);
  // Тягне вільний час із того самого ендпойнту, що й пацієнтська форма.
  assert.match(source, /\/api\/availability\?date=/);
  assert.match(source, /serviceCode=/);
  // Час обирається зі списку слотів, а не вводиться довільно.
  assert.match(source, /<select[^>]*name="time"/);
  assert.doesNotMatch(source, /<input name="time" type="time"/);
  // Порожній розклад блокує збереження.
  assert.match(source, /Немає вільних слотів/);
});

// Ендпойнт вільного часу відкидає конфлікти з бронюваннями й простоями обладнання.
test("availability endpoint filters conflicts and equipment blocks", async () => {
  const source = await readFile(new URL("../app/api/availability/route.ts", import.meta.url), "utf8");
  assert.match(source, /equipment_blocks/);
  assert.match(source, /status IN \\('new','confirmed','rescheduled'\\)/);
  assert.match(source, /overlaps/);
});

// Сервер додатково валідує перенесення: конфлікт слота і блокування апарата.
test("staff bookings PATCH still guards reschedule server-side", async () => {
  const source = await readFile(new URL("../app/api/staff/bookings/route.ts", import.meta.url), "utf8");
  assert.match(source, /Цей час уже зайнятий/);
  assert.match(source, /Апарат недоступний у цей період/);
});
