// Виробничий (норм-)календар: помісячна норма робочих днів і годин за п'ятиденкою.
// Свята — явний, звірений перелік UA_HOLIDAYS нижче (українські свята змінюються
// законодавчо), тож норма рахується прозоро: будній день, що не є святом =
// робочий. Рік без запису в переліку деградує коректно (працює без свят).
//
// Перелік НЕ залежить від зовнішніх сервісів у рантаймі: блок UA_HOLIDAYS між
// маркерами оновлює ОФЛАЙН скрипт scripts/refresh-ua-holidays.mjs із державних
// свят (КЗпП, ст. 73) та обчислених православних Пасхи/Трійці. Рухомі свята —
// детермінована математика (generateHolidays); фіксовані дати треба щороку
// звіряти із законом. Дані тримаємо в цьому ж файлі (self-contained), щоб він
// лишався напряму імпортовним у node --test без розширень у шляхах.
//
// Без урахування свят числа збігаються з типовим 1С-«Графіком роботи»
// (2026: 261 день / 2088 год / 174 середньомісячно). З урахуванням свят —
// законна норма (2026: 256 днів / 2048 год).

export type Holiday = { date: string; name: string };

// Фіксовані державні свята (КЗпП, ст. 73). Дати можуть змінюватися законо-
// давчо — звіряйте щороку перед регенерацією vendored-переліку.
export const FIXED_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "Новий рік" },
  { month: 3, day: 8, name: "Міжнародний жіночий день" },
  { month: 5, day: 1, name: "День праці" },
  { month: 5, day: 9, name: "День перемоги над нацизмом" },
  { month: 6, day: 28, name: "День Конституції України" },
  { month: 8, day: 24, name: "День Незалежності України" },
  { month: 10, day: 1, name: "День захисників і захисниць України" },
  { month: 12, day: 25, name: "Різдво Христове" },
];

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

// Православна Пасха (Великдень) для year → григоріанська ISO-дата.
// Алгоритм Меєуса за юліанським Паschалієм (Україна досі рахує Пасху за ним),
// зсув +13 діб дійсний для 1900–2099.
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const julianMonth = Math.floor((d + e + 114) / 31); // 3=березень, 4=квітень
  const julianDay = ((d + e + 114) % 31) + 1;
  // Юліанська дата → додаємо 13 діб для григоріанської (1900–2099).
  const g = new Date(Date.UTC(year, julianMonth - 1, julianDay));
  g.setUTCDate(g.getUTCDate() + 13);
  return iso(g.getUTCFullYear(), g.getUTCMonth() + 1, g.getUTCDate());
}

// Повний перелік свят для року з правил: фіксовані + рухомі (Великдень і
// Трійця = Великдень + 49 діб), відсортований за датою. Детермінований, без
// мережі — джерело для офлайн-скрипта оновлення vendored-даних.
export function generateHolidays(year: number): Holiday[] {
  const easter = orthodoxEaster(year);
  const trinity = new Date(`${easter}T00:00:00Z`);
  trinity.setUTCDate(trinity.getUTCDate() + 49);
  const list: Holiday[] = [
    ...FIXED_HOLIDAYS.map((h) => ({ date: iso(year, h.month, h.day), name: h.name })),
    { date: easter, name: "Великдень (Пасха)" },
    { date: iso(trinity.getUTCFullYear(), trinity.getUTCMonth() + 1, trinity.getUTCDate()), name: "Трійця" },
  ];
  return list.sort((x, y) => x.date.localeCompare(y.date));
}
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

// Vendored, звірений перелік свят. Блок нижче генерує/оновлює
// scripts/refresh-ua-holidays.mjs — НЕ редагуйте його вручну між маркерами.
// Свято у вихідний норму не зменшує; переноси не застосовуються автоматично.
// ua-holidays:generated:start
export const UA_HOLIDAYS: Record<number, Holiday[]> = {
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
  2027: [
    { date: "2027-01-01", name: "Новий рік" },
    { date: "2027-03-08", name: "Міжнародний жіночий день" },
    { date: "2027-05-01", name: "День праці" },
    { date: "2027-05-02", name: "Великдень (Пасха)" },
    { date: "2027-05-09", name: "День перемоги над нацизмом" },
    { date: "2027-06-20", name: "Трійця" },
    { date: "2027-06-28", name: "День Конституції України" },
    { date: "2027-08-24", name: "День Незалежності України" },
    { date: "2027-10-01", name: "День захисників і захисниць України" },
    { date: "2027-12-25", name: "Різдво Христове" },
  ],
  2028: [
    { date: "2028-01-01", name: "Новий рік" },
    { date: "2028-03-08", name: "Міжнародний жіночий день" },
    { date: "2028-04-16", name: "Великдень (Пасха)" },
    { date: "2028-05-01", name: "День праці" },
    { date: "2028-05-09", name: "День перемоги над нацизмом" },
    { date: "2028-06-04", name: "Трійця" },
    { date: "2028-06-28", name: "День Конституції України" },
    { date: "2028-08-24", name: "День Незалежності України" },
    { date: "2028-10-01", name: "День захисників і захисниць України" },
    { date: "2028-12-25", name: "Різдво Христове" },
  ],
  2029: [
    { date: "2029-01-01", name: "Новий рік" },
    { date: "2029-03-08", name: "Міжнародний жіночий день" },
    { date: "2029-04-08", name: "Великдень (Пасха)" },
    { date: "2029-05-01", name: "День праці" },
    { date: "2029-05-09", name: "День перемоги над нацизмом" },
    { date: "2029-05-27", name: "Трійця" },
    { date: "2029-06-28", name: "День Конституції України" },
    { date: "2029-08-24", name: "День Незалежності України" },
    { date: "2029-10-01", name: "День захисників і захисниць України" },
    { date: "2029-12-25", name: "Різдво Христове" },
  ],
  2030: [
    { date: "2030-01-01", name: "Новий рік" },
    { date: "2030-03-08", name: "Міжнародний жіночий день" },
    { date: "2030-04-28", name: "Великдень (Пасха)" },
    { date: "2030-05-01", name: "День праці" },
    { date: "2030-05-09", name: "День перемоги над нацизмом" },
    { date: "2030-06-16", name: "Трійця" },
    { date: "2030-06-28", name: "День Конституції України" },
    { date: "2030-08-24", name: "День Незалежності України" },
    { date: "2030-10-01", name: "День захисників і захисниць України" },
    { date: "2030-12-25", name: "Різдво Христове" },
  ],
};
// ua-holidays:generated:end

// Рік без запису в переліку деградує коректно (норма без свят).
export function holidaysForYear(year: number): Holiday[] {
  const list = UA_HOLIDAYS[year];
  return list ? list.map((holiday) => ({ ...holiday })) : [];
}

export function hasHolidayData(year: number): boolean {
  return Boolean(UA_HOLIDAYS[year]);
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
