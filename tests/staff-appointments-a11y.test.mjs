// /staff/appointments — тонка сторінка-обгортка над спільним WeekCalendar
// (день/тиждень/список + дошка вільних слотів). Сторінка вже має resilience
// (catch у load/patchBooking, екрани доступу/мережі з «Повторити», фонове
// автооновлення з паузою). Закрито a11y-прогалини календаря:
//  • перемикач вигляду й таби-фільтри стану мали .active без role/aria-pressed;
//  • інпути дати й пошуку мали лише placeholder (WCAG 4.1.2);
//  • плейсхолдер завантаження (.notice) не оголошувався (WCAG 4.1.3).

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("appointments loading placeholder is announced as a status", () => {
  const page = read("app/staff/appointments/page.tsx");
  assert.match(page, /<p className="notice" role="status" aria-live="polite">Завантаження…<\/p>/);
});

test("calendar view toggle and status tabs expose pressed state", () => {
  const cal = read("app/staff/week-calendar.tsx");
  assert.match(cal, /className="apptViewToggle" role="group" aria-label="Вигляд календаря"/);
  assert.match(cal, /aria-pressed=\{view === "week"\}/);
  assert.match(cal, /className="apptStatusRow" role="group" aria-label="Фільтр за станом запису"/);
  assert.match(cal, /aria-pressed=\{tab === t\.key\}/);
});

test("calendar date and search inputs have accessible names", () => {
  const cal = read("app/staff/week-calendar.tsx");
  assert.match(cal, /<input type="date" aria-label="Дата"/);
  assert.match(cal, /<input type="search" aria-label="Пошук за пацієнтом"/);
});
