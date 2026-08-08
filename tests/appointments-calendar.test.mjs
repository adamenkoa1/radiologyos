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
  // Список = агенда у стилі TickTick: велике ім'я + кольорова смуга за типом.
  assert.match(cal, /apptCardName/); // ім'я пацієнта як головний елемент
  assert.match(cal, /modClass\(/); // кольорова смуга за модальністю
  assert.match(cal, /apptCardTags/); // компактні теги (контраст/оплата/військовий)
  const css = await read("app/globals.css");
  assert.match(css, /\.apptCardRow\.mod-ct\b/); // смуга КТ
  assert.match(css, /\.apptCardName\{[^}]*font-size:16px/); // ім'я більше за мету
  // Єдиний Workspace: клік по запису відкриває drawer, а не перехід на сторінку.
  assert.match(cal, /setOpenId\(/); // клік відкриває панель
  assert.match(cal, /apptDrawer/); // права панель
  assert.match(cal, /openHistory/); // історія пацієнта в панелі
  assert.match(cal, /Escape/); // закриття по ESC
  assert.match(css, /\.apptDrawerPanel\b/);
  assert.match(css, /button\.apptCardRow/); // скидання UA-стилів кнопки-рядка
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
  assert.match(shell, /Календар записів/); // лишається як заголовок сторінки (breadcrumb)
  // Меню за процесом: Прийом → Розклад → Опис → Видача (а не за модулями).
  assert.match(shell, /processRail/);
  assert.match(shell, /Робочий процес/);
  for (const step of ["Прийом", "Розклад", "Опис", "Видача"]) {
    assert.match(shell, new RegExp(`label:"${step}"`), `process step ${step}`);
  }
  // «Опис» веде у протоколи, «Видача» — у реєстр досліджень.
  assert.match(shell, /label:"Опис", href:"\/staff\/protocols"/);
  assert.match(shell, /label:"Видача", href:"\/staff\/studies"/);
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
  // Три рівні пріоритету + збагачені картки/рядки.
  assert.match(dash, /dashTier/); // маркери «Робота зараз / сьогодні / Аналітика»
  assert.match(dash, /Робота зараз/);
  assert.match(dash, /modClass/); // кольорова смужка за типом дослідження
  assert.match(dash, /whenLabel/); // «через N хв» на розкладі
  const css = await read("app/globals.css");
  assert.match(css, /@keyframes dashBlink/); // миготіння нових заявок
  assert.match(css, /\.dashMc\{/); // стилі панелі місії
  assert.match(css, /\.dashChip\b/); // стилі фільтрів
  // Робоча область на всю ширину (Variant B): fluid-змінна замість фіксованих 1500px.
  assert.match(css, /--dash-w:/);
  assert.match(css, /\.dashMc\{max-width:var\(--dash-w\)/);
  assert.match(css, /\.dashTier\b/); // маркери рівнів пріоритету
  assert.match(css, /\.dashCard\.mod-ct\b/); // смужка за модальністю
  // Пульт для лікаря: аналітика згорнута за замовчуванням, порожні списки не малюються.
  assert.match(dash, /<details className="dashAnalytics"/); // аналітика у details (згорнута)
  assert.match(dash, /filter\(l => l\.items\.length > 0\)/); // порожні списки ховаємо
  assert.match(css, /details\.dashAnalytics\[open\]/); // стилі згорнутого стану
  // Пацієнт як центр: імʼя веде в картку пацієнта (CRM за телефоном).
  assert.match(dash, /patientHref/);
  assert.match(dash, /\/staff\/patients\?phone=/);
  assert.match(css, /\.patLink\b/);
});
