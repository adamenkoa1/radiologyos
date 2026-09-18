// Посилання «Додати в календар» для екрана підтвердження запису.
// Чиста логіка: будує Google Calendar «TEMPLATE»-URL із деталей візиту. Часи —
// стінний час у поясі Europe/Kyiv (передаємо ctz), тож без зсуву UTC.
// Обчислюється на сервері й кладеться у відповідь /api/site-booking, щоб клієнту
// не тримати цю логіку (і щоб її можна було протестувати).

export type CalendarEvent = {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number;
  details?: string;
  location?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(date: string, time: string): string {
  return date.replace(/-/g, "") + "T" + time.replace(":", "") + "00";
}

// Кінець візиту як стінний час (додаємо хвилини, коректно через межу години/дня).
function endStamp(date: string, time: string, minutes: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, hh, mm));
  at.setUTCMinutes(at.getUTCMinutes() + Math.max(0, minutes));
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}00`
  );
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  if (!DATE_RE.test(ev.date) || !TIME_RE.test(ev.time) || !ev.title) return "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${stamp(ev.date, ev.time)}/${endStamp(ev.date, ev.time, ev.durationMinutes)}`,
    ctz: "Europe/Kyiv",
  });
  if (ev.details) params.set("details", ev.details);
  if (ev.location) params.set("location", ev.location);
  return "https://calendar.google.com/calendar/render?" + params.toString();
}
