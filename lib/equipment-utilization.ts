// Завантаженість обладнання: доступна потужність (робочі хвилини за графіком),
// фактично виконано, заплановано (заброньовано) і простій — за період.
//
// Чиста логіка без залежностей (напряму тестовна). Графік і робочі дні бере
// маршрут із lib/schedule (потужність = робочі дні × денне вікно мінус обід).

export type EquipmentUtilization = {
  equipmentId: string;
  label: string;
  workingDays: number;
  capacityMinutes: number;
  performedMinutes: number;
  performedCount: number;
  bookedMinutes: number;
  utilizationPct: number; // виконано ÷ потужність
  bookedPct: number;      // заброньовано ÷ потужність
  idleMinutes: number;    // потужність − виконано (не менше 0)
};

function toMin(t: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// Корисні робочі хвилини на день для апарата: вікно (end−start) мінус обідня
// перерва, якщо вона в межах вікна.
export function dailyCapacityMinutes(hours: { start: string; end: string; breakStart?: string; breakEnd?: string }): number {
  const start = toMin(hours.start);
  const end = toMin(hours.end);
  if (end <= start) return 0;
  let minutes = end - start;
  if (hours.breakStart && hours.breakEnd) {
    const bs = toMin(hours.breakStart);
    const be = toMin(hours.breakEnd);
    if (be > bs && bs >= start && be <= end) minutes -= (be - bs);
  }
  return Math.max(minutes, 0);
}

// Усі дати YYYY-MM-DD у діапазоні [from, to] включно.
export function datesInRange(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime()) || cur > end) return [];
  // Обмеження безпеки: не більше ~2 років діапазону.
  for (let guard = 0; cur <= end && guard < 800; guard += 1) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export function utilizationRow(input: {
  equipmentId: string; label: string; workingDays: number; dailyCapacityMinutes: number;
  performedMinutes: number; performedCount: number; bookedMinutes: number;
}): EquipmentUtilization {
  const capacityMinutes = Math.max(input.workingDays, 0) * Math.max(input.dailyCapacityMinutes, 0);
  return {
    equipmentId: input.equipmentId,
    label: input.label,
    workingDays: input.workingDays,
    capacityMinutes,
    performedMinutes: input.performedMinutes,
    performedCount: input.performedCount,
    bookedMinutes: input.bookedMinutes,
    utilizationPct: pct(input.performedMinutes, capacityMinutes),
    bookedPct: pct(input.bookedMinutes, capacityMinutes),
    idleMinutes: Math.max(capacityMinutes - input.performedMinutes, 0),
  };
}

export function summarizeUtilization(rows: EquipmentUtilization[]): Omit<EquipmentUtilization, "equipmentId" | "label"> {
  const sum = (pick: (r: EquipmentUtilization) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const capacityMinutes = sum((r) => r.capacityMinutes);
  const performedMinutes = sum((r) => r.performedMinutes);
  const bookedMinutes = sum((r) => r.bookedMinutes);
  return {
    workingDays: rows.reduce((a, r) => Math.max(a, r.workingDays), 0),
    capacityMinutes,
    performedMinutes,
    performedCount: sum((r) => r.performedCount),
    bookedMinutes,
    utilizationPct: pct(performedMinutes, capacityMinutes),
    bookedPct: pct(bookedMinutes, capacityMinutes),
    idleMinutes: Math.max(capacityMinutes - performedMinutes, 0),
  };
}
