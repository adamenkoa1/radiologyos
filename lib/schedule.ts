// Налаштовуваний графік прийому: години й крок слота по апаратах, робочі дні
// тижня та конкретні вихідні (свята). Зберігається у app_settings (ключ
// equipment_schedule). Читається /api/availability і «Новою записом».
// Типові значення дублюють EQUIPMENT з lib/catalog, тож без конфігу поведінка
// не змінюється. Чистий модуль без залежностей (тестований).

export type EquipHours = { start: string; end: string; slotMinutes: number };
export type ScheduleConfig = {
  equipment: Record<string, EquipHours>;
  weekdays: number[]; // відкриті дні тижня, 1=Пн … 6=Сб (неділя завжди закрита)
  daysOff: string[];  // конкретні закриті дати YYYY-MM-DD
};

export const SCHEDULE_KEY = "equipment_schedule";
export const EQUIP_KEYS = ["ct", "xray", "fluoro"] as const;
export const EQUIP_LABELS: Record<string, string> = {
  ct: "Комп’ютерний томограф", xray: "Цифровий рентген", fluoro: "Флюорограф",
};

export const SCHEDULE_DEFAULTS: ScheduleConfig = {
  equipment: {
    ct: { start: "08:00", end: "17:00", slotMinutes: 30 },
    xray: { start: "08:00", end: "17:00", slotMinutes: 15 },
    fluoro: { start: "08:00", end: "17:00", slotMinutes: 15 },
  },
  weekdays: [1, 2, 3, 4, 5, 6],
  daysOff: [],
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function toMin(t: string): number { const m = /^(\d{2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
function fromMin(n: number): string { return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; }

// Слоти для апарата з урахуванням тривалості дослідження.
export function candidateTimesFor(hours: EquipHours, durationMinutes: number): string[] {
  const out: string[] = [];
  const end = toMin(hours.end);
  const step = hours.slotMinutes > 0 ? hours.slotMinutes : 15;
  for (let t = toMin(hours.start); t + durationMinutes <= end; t += step) out.push(fromMin(t));
  return out;
}

// Чи відкритий заклад у цю дату (робочий день тижня і не вихідний/свято).
export function isDayOpen(date: string, cfg: ScheduleConfig): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (cfg.daysOff.includes(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return cfg.weekdays.includes(d.getUTCDay());
}

export function hoursFor(cfg: ScheduleConfig, equipmentId: string): EquipHours {
  return cfg.equipment[equipmentId] || SCHEDULE_DEFAULTS.equipment[equipmentId] || SCHEDULE_DEFAULTS.equipment.ct;
}

export function sanitizeSchedule(input: unknown): ScheduleConfig {
  const src = (input && typeof input === "object") ? input as Record<string, unknown> : {};
  const srcEquip = (src.equipment && typeof src.equipment === "object") ? src.equipment as Record<string, { start?: unknown; end?: unknown; slotMinutes?: unknown }> : {};
  const equipment: Record<string, EquipHours> = {};
  for (const key of EQUIP_KEYS) {
    const d = SCHEDULE_DEFAULTS.equipment[key];
    const e = srcEquip[key] || {};
    const start = typeof e.start === "string" && HHMM.test(e.start) ? e.start : d.start;
    const end = typeof e.end === "string" && HHMM.test(e.end) ? e.end : d.end;
    let step = Number(e.slotMinutes);
    if (!Number.isInteger(step) || step < 5 || step > 240) step = d.slotMinutes;
    equipment[key] = toMin(end) > toMin(start) ? { start, end, slotMinutes: step } : { ...d };
  }
  const rawWk = Array.isArray(src.weekdays) ? src.weekdays.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 6) : [];
  const weekdays = rawWk.length ? Array.from(new Set(rawWk)).sort((a, b) => a - b) : [...SCHEDULE_DEFAULTS.weekdays];
  const daysOff = Array.isArray(src.daysOff)
    ? Array.from(new Set(src.daysOff.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))).slice(0, 200)
    : [];
  return { equipment, weekdays, daysOff };
}

export function parseSchedule(stored: string): ScheduleConfig {
  if (!stored) return sanitizeSchedule({});
  try { return sanitizeSchedule(JSON.parse(stored)); } catch { return sanitizeSchedule({}); }
}
