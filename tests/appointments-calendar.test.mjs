import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared week calendar component offers list/day/week views", async () => {
  const cal = await read("app/staff/week-calendar.tsx");
  assert.match(cal, /view === "list"/);
  assert.match(cal, /view === "day"/);
  assert.match(cal, /view === "week"/);
  assert.match(cal, /roomSlotBoard/); // таймлайн по годинах
  assert.match(cal, /apptWeek/); // сітка тижня
  assert.match(cal, /weekDates\(/); // тиждень від понеділка
  assert.match(cal, /stateLabel\(/); // людські підписи станів
});

test("status filter groups map to real booking statuses", async () => {
  const cal = await read("app/staff/week-calendar.tsx");
  for (const s of ["planned", "confirmed", "arrived", "inroom", "done", "cancelled"]) {
    assert.match(cal, new RegExp(`${s}:`), `group ${s} present`);
  }
  assert.match(cal, /confirmed: \["confirmed"\]/);
});

test("appointments page renders the shared calendar in the staff shell", async () => {
  const page = await read("app/staff/appointments/page.tsx");
  assert.match(page, /active="appointments"/);
  assert.match(page, /\/api\/staff\/bookings/); // реальні дані, без нового бекенду
  assert.match(page, /WeekCalendar/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/appointments"/);
  assert.match(shell, /Календар записів/);
});

test("dashboard shows a compact today agenda and a one-click confirm queue", async () => {
  const dash = await read("app/staff/dashboard/page.tsx");
  // Повний тижневий календар живе в окремому розділі; пульт дає короткий
  // огляд «на сьогодні» + перехід у «Календар записів».
  assert.doesNotMatch(dash, /WeekCalendar/);
  assert.match(dash, /Розклад на сьогодні/);
  assert.match(dash, /dashAgenda/);
  assert.match(dash, /href="\/staff\/appointments"/);
  assert.match(dash, /dashKpiStrip/); // компактні картки замість великих блоків
  assert.match(dash, /dashPending/); // черга нових заявок
  assert.match(dash, /confirm:true/); // підтвердження одним кліком
  assert.match(dash, /WhatsApp/); // повідомлення пацієнту
  // Пульт як «місія»: рядок головних чисел дня + фільтри розкладу + аналітика внизу.
  assert.match(dash, /dashMc/); // панель головних показників дня
  assert.match(dash, /нових заявок/);
  assert.match(dash, /dashCards/); // нові заявки картками
  assert.match(dash, /dashChips/); // швидкі фільтри розкладу
  assert.match(dash, /dashAnalytics/); // аналітика — нижче агенди
  const css = await read("app/globals.css");
  assert.match(css, /@keyframes dashBlink/); // миготіння нових заявок
  assert.match(css, /\.dashMc\{/); // стилі панелі місії
  assert.match(css, /\.dashChip\b/); // стилі фільтрів
});
