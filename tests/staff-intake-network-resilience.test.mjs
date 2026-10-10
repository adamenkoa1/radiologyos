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
