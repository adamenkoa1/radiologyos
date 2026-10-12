// Дошка прийому (`/staff/intake`): основні дії реєстратора — створення заявки
// та PATCH (підтвердити/скасувати/перенести/зберегти правки) — мали
// try/finally БЕЗ catch. Виклик через `void patch(...)` / submit ковтав
// мережевий throw: кнопка відпускалася (finally скидав busy), але жодного
// повідомлення не було — дія ставала мовчазним no-op, і реєстратор не знав,
// що вона не пройшла. Додано catch із flash-повідомленням.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("intake patch() surfaces a network failure instead of a silent no-op", async () => {
  const page = await read("app/staff/intake/page.tsx");
  // patch має catch між try і finally
  assert.match(page, /async function patch\([\s\S]*?\} catch \{[\s\S]*?flash\("Немає зв’язку — дію не виконано[\s\S]*?\} finally \{ setBusy\(false\); \}/);
});

test("intake createBooking() surfaces a network failure instead of a silent no-op", async () => {
  const page = await read("app/staff/intake/page.tsx");
  assert.match(page, /async function createBooking\([\s\S]*?\} catch \{[\s\S]*?flash\("Немає зв’язку — заявку не створено[\s\S]*?\} finally \{ setBusy\(false\); \}/);
});

test("intake a11y: filter toggle, search, selected card and loading are exposed to AT", async () => {
  const page = await read("app/staff/intake/page.tsx");
  // Перемикач фільтра — група з aria-pressed
  assert.match(page, /className="intakeSeg" role="group" aria-label="Фільтр заявок"/);
  assert.match(page, /<button type="button" aria-pressed=\{filter==="attention"\}/);
  assert.match(page, /<button type="button" aria-pressed=\{filter==="all"\}/);
  // Пошук має доступну назву (placeholder не рахується)
  assert.match(page, /<input type="search" aria-label="Пошук заявок за ім'ям, телефоном або кодом"/);
  // Вибрана картка — aria-current
  assert.match(page, /aria-current=\{b\.id===selectedId&&!creating \? "true" : undefined\}/);
  // Завантаження оголошується
  assert.match(page, /<p className="dashLoading" role="status" aria-live="polite">Завантаження…<\/p>/);
});

test("intake interactive controls have a visible keyboard focus ring", async () => {
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /\.intakeSeg button:focus-visible,\.intakeCard:focus-visible[\s\S]*?outline:2px solid #0c7a85;outline-offset:2px\}/);
});
