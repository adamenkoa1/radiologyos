// Дата народження у форматі YYYY-MM-DD (те, що дає <input type="date">).
// Використовується і при записі пацієнта, і як код входу в кабінет
// (телефон + дата народження). Повертає нормалізоване значення або "".
export function normalizeDob(value: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  const [, year, month, day] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) return "";
  return `${year}-${month}-${day}`;
}

// Перевірка повноліття виконується на сервері, а не лише обмеженням поля у
// браузері. todayIso передається тестами для перевірки дня 18-річчя.
export function isAdultDob(value: unknown, minimumAge = 18, todayIso?: string): boolean {
  const dob = normalizeDob(value);
  if (!dob) return false;
  const today = normalizeDob(todayIso || new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()));
  if (!today) return false;
  const [year, month, day] = today.split("-").map(Number);
  const latestAdultDob = new Date(Date.UTC(year - minimumAge, month - 1, day));
  return dob <= latestAdultDob.toISOString().slice(0, 10);
}
