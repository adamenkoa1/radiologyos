// Дата народження у форматі YYYY-MM-DD (те, що дає <input type="date">).
// Використовується і при записі пацієнта, і як код входу в кабінет
// (телефон + дата народження). Повертає нормалізоване значення або "".
export function normalizeDob(value: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  const [, year, month, day] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${year}-${month}-${day}`;
}
