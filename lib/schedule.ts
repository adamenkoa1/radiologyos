// Налаштовуваний графік прийому: години й крок слота по апаратах, робочі дні
// тижня та конкретні вихідні (свята). Зберігається у app_settings (ключ
// equipment_schedule). Читається /api/availability і «Новою записом».
// Типові значення дублюють EQUIPMENT з lib/catalog, тож без конфігу поведінка
// не змінюється. Чистий модуль без залежностей (тестований).

// Обідня перерва (breakStart/breakEnd) — необов'язкова: якщо задана, слоти,
// що її перетинають, не пропонуються (дає два вікна прийому: до і після обіду).
export type EquipHours = {
  start: string; end: string; slotMinutes: number; breakStart?: string; breakEnd?: string;
  radiographerEmail?: string; radiologistEmail?: string; teamEmails?: string[];
  weekdays?: number[]; daysOff?: string[];
};
export type ScheduleConfig = {
  equipment: Record<string, EquipHours>;
  weekdays: number[]; // відкриті дні тижня, 1=Пн … 6=Сб (неділя завжди закрита)
  daysOff: string[];  // конкретні закриті дати YYYY-MM-DD
  dateOverrides: Record<string, Record<string, boolean>>; // ручний стан дати для кабінету
};

export const SCHEDULE_KEY = "equipment_schedule";
export const EQUIP_KEYS = ["ct", "xray", "fluoro"] as const;
export const EQUIP_LABELS: Record<string, string> = {
  ct: "Комп’ютерний томограф", xray: "Цифровий рентген", fluoro: "Флюорограф",
};

// Типові години прийому амбулаторних пацієнтів (з внутрішнього розпорядку
// відділення). Флюорографія 9:30–13:00 та 14:00–16:00; рентгенографія
// 10:00–13:00 та 14:00–15:00; обід у відділенні 13:00–14:00. КТ — робочий день
// з тією ж обідньою перервою (адміністратор може змінити у «Графік і слоти»).
export const SCHEDULE_DEFAULTS: ScheduleConfig = {
  equipment: {
    ct: { start: "08:00", end: "17:00", slotMinutes: 30, breakStart: "13:00", breakEnd: "14:00", weekdays: [1, 2, 3, 4, 5, 6], daysOff: [] },
    xray: { start: "10:00", end: "15:00", slotMinutes: 15, breakStart: "13:00", breakEnd: "14:00", weekdays: [1, 2, 3, 4, 5, 6], daysOff: [] },
    fluoro: { start: "09:30", end: "16:00", slotMinutes: 15, breakStart: "13:00", breakEnd: "14:00", weekdays: [1, 2, 3, 4, 5, 6], daysOff: [] },
  },
  weekdays: [1, 2, 3, 4, 5, 6],
  daysOff: [],
  dateOverrides: { ct: {}, xray: {}, fluoro: {} },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function toMin(t: string): number { const m = /^(\d{2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
function fromMin(n: number): string { return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; }

// Слоти для апарата з урахуванням тривалості дослідження.
export function candidateTimesFor(hours: EquipHours, durationMinutes: number): string[] {
  const out: string[] = [];
  const end = toMin(hours.end);
  const step = hours.slotMinutes > 0 ? hours.slotMinutes : 15;
  // Обідня перерва: валідна лише якщо обидві межі коректні й breakEnd > breakStart.
  const hasBreak = !!hours.breakStart && !!hours.breakEnd
    && HHMM.test(hours.breakStart) && HHMM.test(hours.breakEnd)
    && toMin(hours.breakEnd) > toMin(hours.breakStart);
  const bStart = hasBreak ? toMin(hours.breakStart as string) : 0;
  const bEnd = hasBreak ? toMin(hours.breakEnd as string) : 0;
  for (let t = toMin(hours.start); t + durationMinutes <= end; t += step) {
    // Слот, що перетинається з обідньою перервою, не пропонуємо.
    if (hasBreak && t < bEnd && t + durationMinutes > bStart) continue;
    out.push(fromMin(t));
  }
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

export function isEquipmentDayOpen(date: string, cfg: ScheduleConfig, equipmentId: string): boolean {
  const override = cfg.dateOverrides?.[equipmentId]?.[date];
  if (typeof override === "boolean") return override;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const room = hoursFor(cfg, equipmentId);
  const daysOff = room.daysOff ?? cfg.daysOff;
  if (daysOff.includes(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return (room.weekdays ?? cfg.weekdays).includes(parsed.getUTCDay());
}

export function hoursFor(cfg: ScheduleConfig, equipmentId: string): EquipHours {
  return cfg.equipment[equipmentId] || SCHEDULE_DEFAULTS.equipment[equipmentId] || SCHEDULE_DEFAULTS.equipment.ct;
}

export function sanitizeSchedule(input: unknown): ScheduleConfig {
  const src = (input && typeof input === "object") ? input as Record<string, unknown> : {};
  const rawLegacyWeekdays = Array.isArray(src.weekdays) ? src.weekdays.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 6) : [];
  const legacyWeekdays = rawLegacyWeekdays.length ? Array.from(new Set(rawLegacyWeekdays)).sort((a, b) => a - b) : [...SCHEDULE_DEFAULTS.weekdays];
  const legacyDaysOff = Array.isArray(src.daysOff)
    ? Array.from(new Set(src.daysOff.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))).slice(0, 200)
    : [];
  const srcEquip = (src.equipment && typeof src.equipment === "object") ? src.equipment as Record<string, { start?: unknown; end?: unknown; slotMinutes?: unknown; breakStart?: unknown; breakEnd?: unknown; radiographerEmail?: unknown; radiologistEmail?: unknown; teamEmails?: unknown; weekdays?: unknown; daysOff?: unknown }> : {};
  const equipment: Record<string, EquipHours> = {};
  for (const key of EQUIP_KEYS) {
    const d = SCHEDULE_DEFAULTS.equipment[key];
    const e = srcEquip[key] || {};
    const start = typeof e.start === "string" && HHMM.test(e.start) ? e.start : d.start;
    const end = typeof e.end === "string" && HHMM.test(e.end) ? e.end : d.end;
    let step = Number(e.slotMinutes);
    if (!Number.isInteger(step) || step < 5 || step > 240) step = d.slotMinutes;
    const eh: EquipHours = toMin(end) > toMin(start) ? { start, end, slotMinutes: step } : { ...d };
    // Обідня перерва: якщо у вводі є ключі перерви — беремо їх (валідні) або
    // очищаємо (порожні/некоректні); якщо ключів немає — успадковуємо типову.
    let bs = d.breakStart, be = d.breakEnd;
    if ("breakStart" in e || "breakEnd" in e) {
      const inS = e.breakStart, inE = e.breakEnd;
      bs = typeof inS === "string" && HHMM.test(inS) ? inS : undefined;
      be = typeof inE === "string" && HHMM.test(inE) ? inE : undefined;
    }
    // Перерва має бути в межах [start, end] і мати додатну тривалість.
    if (bs && be && toMin(be) > toMin(bs) && toMin(bs) >= toMin(eh.start) && toMin(be) <= toMin(eh.end)) {
      eh.breakStart = bs; eh.breakEnd = be;
    } else { delete eh.breakStart; delete eh.breakEnd; }
    if (typeof e.radiographerEmail === "string" && e.radiographerEmail.length <= 254) eh.radiographerEmail = e.radiographerEmail.trim().toLowerCase();
    if (typeof e.radiologistEmail === "string" && e.radiologistEmail.length <= 254) eh.radiologistEmail = e.radiologistEmail.trim().toLowerCase();
    if (Array.isArray(e.teamEmails)) eh.teamEmails = [...new Set(e.teamEmails.filter((v): v is string => typeof v === "string").map(v => v.trim().toLowerCase()).filter(v => v.length > 0 && v.length <= 254))].slice(0, 30);
    const roomWeekdays = Array.isArray(e.weekdays) ? e.weekdays.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 6) : [];
    eh.weekdays = roomWeekdays.length ? Array.from(new Set(roomWeekdays)).sort((a, b) => a - b) : [...legacyWeekdays];
    eh.daysOff = Array.isArray(e.daysOff)
      ? Array.from(new Set(e.daysOff.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))).slice(0, 200)
      : [...legacyDaysOff];
    equipment[key] = eh;
  }
  const weekdays = legacyWeekdays;
  const daysOff = legacyDaysOff;
  const rawOverrides = src.dateOverrides && typeof src.dateOverrides === "object" ? src.dateOverrides as Record<string, unknown> : {};
  const dateOverrides: Record<string, Record<string, boolean>> = {};
  for (const key of EQUIP_KEYS) {
    const values = rawOverrides[key] && typeof rawOverrides[key] === "object" ? rawOverrides[key] as Record<string, unknown> : {};
    dateOverrides[key] = Object.fromEntries(Object.entries(values)
      .filter(([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof value === "boolean").slice(0, 400)) as Record<string, boolean>;
  }
  return { equipment, weekdays, daysOff, dateOverrides };
}

export function parseSchedule(stored: string): ScheduleConfig {
  if (!stored) return sanitizeSchedule({});
  try { return sanitizeSchedule(JSON.parse(stored)); } catch { return sanitizeSchedule({}); }
}
