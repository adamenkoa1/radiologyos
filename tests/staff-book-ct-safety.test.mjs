// Форма запису (/staff/book) для реєстратора: (1) при КТ з контрастуванням для
// пацієнта з позначкою «реакція на контраст» показує застереження; (2) при
// «Вільного часу немає» пропонує найближчу вільну дату (скан наперед).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = () => readFile(new URL("../app/staff/book/page.tsx", import.meta.url), "utf8");

test("book form loads patient flags and warns on contrast alert", async () => {
  const page = await read();
  // Тягне картку пацієнта за patientId, читає прапорці.
  assert.match(page, /\/api\/staff\/patients\?patientId=/);
  assert.match(page, /contrastAlert: !!card\.profile\?\.contrastAlert/);
  // Контрастна послуга визначається за групою; застереження показується.
  assert.match(page, /isContrastService = \/контраст\|ангіограф\/i\.test/);
  assert.match(page, /isContrastService && patientFlags\?\.contrastAlert/);
  assert.match(page, /реакцію на контрастну речовину/);
  assert.match(page, /patientFlags\?\.doNotContact/);
});

test("book form suggests the nearest free date when a day has no slots", async () => {
  const page = await read();
  assert.match(page, /const noSlots = Boolean\(date && serviceCode && !slotsLoading && times\.length === 0\)/);
  // Сканує до 14 днів наперед через /api/availability.
  assert.match(page, /for \(let i = 1; i <= 14/);
  assert.match(page, /setNearest\(iso\)/);
  assert.match(page, /Найближча вільна дата/);
  assert.match(page, /onClick=\{\(\) => setDate\(nearest\)\}/);
});
