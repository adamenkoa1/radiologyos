// Чиста логіка планових нагадувань — без залежностей (як lib/schedule,
// lib/whatsapp-bot тощо), щоб виконуватись у тестах напряму. Ввід-вивід
// (читання БД, надсилання WhatsApp) — у lib/reminders.ts.

export const REMINDER_LEAD_KEY = "reminder_lead_hours";
// За замовчуванням: за добу (нагадування «напередодні»), за 3 год і за 1 год.
export const REMINDER_LEAD_DEFAULT = [24, 3, 1];
// Вікно «спіймати» нагадування: cron ходить ~кожні 15 хв, тож 25-хв вікно
// переживає один пропущений запуск. Повтори не дублюються завдяки дедуплікації
// за kind у patient_notifications.
export const SLACK_MINUTES = 25;

// Парсинг налаштування «3, 1» → [3, 1]. Ціле 1..24 год, унікальні, спадання, ≤5.
export function parseLeadHours(setting: string | undefined | null): number[] {
  if (setting == null || setting.trim() === "") return [...REMINDER_LEAD_DEFAULT];
  const hours = setting.split(/[,;\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 24);
  const unique = Array.from(new Set(hours)).sort((a, b) => b - a).slice(0, 5);
  return unique.length ? unique : [...REMINDER_LEAD_DEFAULT];
}

export type LeadBooking = { id: number; minutesUntil: number };

// Для кожного запису й кожного ліду вирішує, чи час надіслати нагадування.
// alreadySent містить ключі `${id}:reminder_${h}h`, щоб не дублювати.
export function dueReminders(
  bookings: LeadBooking[],
  leads: number[],
  alreadySent: Set<string>,
): Array<{ id: number; hours: number }> {
  const out: Array<{ id: number; hours: number }> = [];
  for (const b of bookings) {
    if (!(b.minutesUntil > 0)) continue; // візит уже минув або зараз
    for (const h of leads) {
      const leadMin = h * 60;
      if (b.minutesUntil <= leadMin && b.minutesUntil > leadMin - SLACK_MINUTES
          && !alreadySent.has(`${b.id}:reminder_${h}h`)) {
        out.push({ id: b.id, hours: h });
      }
    }
  }
  return out;
}

export function leadReminderText(
  service: string, time: string, hours: number, dayLabel = "сьогодні",
): string {
  const when = time ? `${dayLabel} о ${time}` : dayLabel;
  return `Нагадування: за ${hours} год у вас запис на «${service}» — ${when}. `
    + `Відділення променевої діагностики. Якщо час не підходить — зателефонуйте у реєстратуру.`;
}

// Календарна різниця в днях між двома датами YYYY-MM-DD (to - from).
export function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return null;
  const ax = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const bx = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((bx - ax) / 86_400_000);
}

// Дата YYYY-MM-DD, зсунута на N днів (для запиту «сьогодні + завтра»).
export function addDaysToDate(dateStr: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

// Хвилини до візиту з урахуванням переходу через добу (напр. нагадування
// «напередодні» о 24 год для завтрашнього візиту). Може бути > 1440.
export function minutesUntilBooking(
  todayDate: string, nowMin: number, desiredDate: string, desiredTime: string,
): number | null {
  const t = minutesOfTime(desiredTime);
  if (t == null) return null;
  const diff = daysBetween(todayDate, desiredDate);
  if (diff == null) return null;
  return diff * 1440 + t - nowMin;
}

// Людський підпис дня візиту для тексту нагадування.
export function visitDayLabel(desiredDate: string, todayDate: string): string {
  const diff = daysBetween(todayDate, desiredDate);
  if (diff === 0) return "сьогодні";
  if (diff === 1) return "завтра";
  return desiredDate;
}

export type ChannelName = "telegram" | "email" | "whatsapp" | "sms";

// Ланцюжок каналів для планового нагадування: пробуємо по черзі й
// зупиняємось на першому успішному. Порядок — Telegram → e-mail → WhatsApp → SMS.
export function reminderChannelChain(available: Partial<Record<ChannelName, boolean>>): ChannelName[] {
  const order: ChannelName[] = ["telegram", "email", "whatsapp", "sms"];
  return order.filter((c) => available[c]);
}

// Поточний час у Києві: дата YYYY-MM-DD і хвилини від початку доби.
export function kyivNow(nowMs: number): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { date, minutes };
}

export function minutesOfTime(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
