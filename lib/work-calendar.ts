// Виробничий (норм-)календар: помісячна норма робочих днів і годин за п'ятиденкою.
// Свята — явний, редаговний перелік (українські свята змінюються законодавчо),
// тож норма рахується прозоро: будній день, що не є святом = робочий.
//
// Без урахування свят числа збігаються з типовим 1С-«Графіком роботи»
// (2026: 261 день / 2088 год / 174 середньомісячно). З урахуванням свят —
// законна норма (2026: 256 днів / 2048 год).

export type Holiday = { date: string; name: string };
export type WorkMonth = { month: number; label: string; workingDays: number; hours: number; holidays: number };
export type WorkCalendar = {
  year: number;
  hoursPerDay: number;
  includeHolidays: boolean;
  hasHolidayData: boolean;
  months: WorkMonth[];
  totalDays: number;
  totalHours: number;
  avgMonthlyHours: number;
};

const MONTH_LABELS = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень",
];

// Державні свята та неробочі дні України. Перелік свідомо явний — його треба
// звіряти щороку (дати рухомих свят і законодавчі зміни, напр. День перемоги
// 8/9 травня). Свято у вихідний норму не зменшує; переноси не застосовуються
// автоматично — за потреби додайте/приберіть дату.
const HOLIDAYS: Record<number, Holiday[]> = {
  2026: [
    { date: "2026-01-01", name: "Новий рік" },
    { date: "2026-03-08", name: "Міжнародний жіночий день" },
    { date: "2026-04-12", name: "Великдень (Пасха)" },
    { date: "2026-05-01", name: "День праці" },
    { date: "2026-05-09", name: "День перемоги над нацизмом" },
    { date: "2026-05-31", name: "Трійця" },
    { date: "2026-06-28", name: "День Конституції України" },
    { date: "2026-08-24", name: "День Незалежності України" },
    { date: "2026-10-01", name: "День захисників і захисниць України" },
    { date: "2026-12-25", name: "Різдво Христове" },
  ],
};

export function holidaysForYear(year: number): Holiday[] {
  return HOLIDAYS[year] ? HOLIDAYS[year].map((holiday) => ({ ...holiday })) : [];
}

export function hasHolidayData(year: number): boolean {
  return Boolean(HOLIDAYS[year]);
}

export function workCalendar(
  year: number,
  options: { hoursPerDay?: number; includeHolidays?: boolean } = {},
): WorkCalendar {
  const hoursPerDay = options.hoursPerDay ?? 8;
  const includeHolidays = options.includeHolidays ?? false;
  const holidaySet = new Set(includeHolidays ? holidaysForYear(year).map((holiday) => holiday.date) : []);

  const months: WorkMonth[] = [];
  let totalDays = 0;
  for (let m = 0; m < 12; m += 1) {
    const daysInMonth = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    let workingDays = 0;
    let holidays = 0;
    for (let d = 1; d <= daysInMonth; d += 1) {
      const weekday = new Date(Date.UTC(year, m, d)).getUTCDay(); // 0=Нд … 6=Сб
      if (weekday === 0 || weekday === 6) continue; // вихідні
      const iso = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (holidaySet.has(iso)) { holidays += 1; continue; } // святковий будній день
      workingDays += 1;
    }
    totalDays += workingDays;
    months.push({ month: m + 1, label: MONTH_LABELS[m], workingDays, hours: workingDays * hoursPerDay, holidays });
  }

  const totalHours = totalDays * hoursPerDay;
  return {
    year,
    hoursPerDay,
    includeHolidays,
    hasHolidayData: hasHolidayData(year),
    months,
    totalDays,
    totalHours,
    avgMonthlyHours: Math.round((totalHours / 12) * 100) / 100,
  };
}
