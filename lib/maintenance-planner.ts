// Чистий шар планувальника ТО: групує активні записи обслуговування за
// горизонтом строку (`dueDate`) відносно сьогодні. Без стану/мережі/DOM — лише
// детерміновані правила над НАЯВНИМИ даними журналу ТО. Не створює нового API й
// не потребує міграції: це forward-looking подання поверх `equipment_maintenance`.

export type MaintenanceBucket = "overdue" | "today" | "week" | "month" | "later";

export const MAINTENANCE_BUCKET_LABELS: Record<MaintenanceBucket, string> = {
  overdue: "Прострочено",
  today: "Сьогодні",
  week: "Найближчі 7 днів",
  month: "До 30 днів",
  later: "Пізніше",
};

export const MAINTENANCE_BUCKET_ORDER: MaintenanceBucket[] = ["overdue", "today", "week", "month", "later"];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Різниця в цілих днях (due − today) для дат YYYY-MM-DD. Від'ємне = у минулому.
// null — якщо будь-яка дата відсутня/некоректна.
export function daysUntil(today: string, due: string): number | null {
  if (!ISO.test(today) || !ISO.test(due)) return null;
  const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const d = Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10));
  return Math.round((d - t) / 86400000);
}

// Бакет за строком; null коли дати немає/некоректна (у планувальник не входить).
export function maintenanceBucket(today: string, due: string): MaintenanceBucket | null {
  const n = daysUntil(today, due);
  if (n === null) return null;
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  if (n <= 7) return "week";
  if (n <= 30) return "month";
  return "later";
}

type PlannerEvent = { status: string; dueDate: string };

// Запис належить планувальнику, лише якщо він активний (open/in_progress) і має
// строк. Завершені/скасовані та записи без дати не планують наперед.
export function isPlannerEvent(e: PlannerEvent): boolean {
  return (e.status === "open" || e.status === "in_progress") && !!e.dueDate;
}

// Групує активні датовані записи у впорядковані бакети; порожні бакети опущено,
// кожен відсортований за строком зростання.
export function bucketMaintenance<T extends PlannerEvent>(
  events: T[],
  today: string,
): Array<{ bucket: MaintenanceBucket; label: string; items: T[] }> {
  const groups = new Map<MaintenanceBucket, T[]>();
  for (const e of events) {
    if (!isPlannerEvent(e)) continue;
    const b = maintenanceBucket(today, e.dueDate);
    if (!b) continue;
    const list = groups.get(b) ?? [];
    list.push(e);
    groups.set(b, list);
  }
  for (const items of groups.values()) items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return MAINTENANCE_BUCKET_ORDER
    .filter((b) => (groups.get(b)?.length ?? 0) > 0)
    .map((b) => ({ bucket: b, label: MAINTENANCE_BUCKET_LABELS[b], items: groups.get(b)! }));
}

// Кількість активних датованих записів у горизонті [0..days] днів (включно) —
// для KPI «найближчі N днів».
export function upcomingCount(events: PlannerEvent[], today: string, days: number): number {
  return events.filter((e) => {
    if (!isPlannerEvent(e)) return false;
    const n = daysUntil(today, e.dueDate);
    return n !== null && n >= 0 && n <= days;
  }).length;
}
