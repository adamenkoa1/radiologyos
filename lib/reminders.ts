// Планові нагадування пацієнтам за N годин до візиту (напр. за 3 год і за 1 год).
// Запускається cron-тригером Cloudflare (scheduled-handler у worker/index.ts).
// Чиста логіка «які нагадування настали» — у lib/reminders-core.ts (тестована);
// тут лише ввід-вивід: читання БД, надсилання WhatsApp, дедуплікація.

import { getSettings } from "./settings";
import { sendWhatsApp, whatsappConfig, whatsappConfigured } from "./whatsapp";
import {
  REMINDER_LEAD_KEY, dueReminders, kyivNow, leadReminderText, minutesOfTime,
  parseLeadHours, type LeadBooking,
} from "./reminders-core";

export { REMINDER_LEAD_KEY, parseLeadHours };

type ReminderRow = {
  id: number; name: string; phone: string; phoneNormalized: string;
  service: string; desiredTime: string;
};

// Раннер: читає налаштування й записи на сьогодні, вирішує через dueReminders,
// надсилає WhatsApp і фіксує в patient_notifications (з дедуплікацією за kind).
// Ніколи не кидає виняток — cron не має «падати».
export async function runDueReminders(db: D1Database, nowMs: number): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  try {
    const cfg = await getSettings(db, ["patient_reminders_enabled", REMINDER_LEAD_KEY]);
    if (!["1", "true", "on", "yes"].includes((cfg.patient_reminders_enabled || "").trim().toLowerCase())) {
      return result; // нагадування вимкнені
    }
    const wa = await whatsappConfig(db);
    if (!whatsappConfigured(wa) || !wa.enabled) return result; // немає куди слати

    const leads = parseLeadHours(cfg[REMINDER_LEAD_KEY]);
    const { date, minutes: nowMin } = kyivNow(nowMs);

    const rows = await db.prepare(
      `SELECT id, name, phone, phone_normalized AS phoneNormalized, service, desired_time AS desiredTime
       FROM bookings WHERE desired_date = ? AND status IN ('confirmed','rescheduled')`
    ).bind(date).all<ReminderRow>();
    const bookings = (rows.results || []);
    if (!bookings.length) return result;

    const leadBookings: LeadBooking[] = [];
    const byId = new Map<number, ReminderRow>();
    for (const b of bookings) {
      const t = minutesOfTime(b.desiredTime);
      if (t == null) continue;
      byId.set(b.id, b);
      leadBookings.push({ id: b.id, minutesUntil: t - nowMin });
    }

    // Уже надіслані нагадування (щоб не дублювати) + список «не турбувати».
    const [sentRows, dncRows] = await Promise.all([
      db.prepare(
        `SELECT booking_id AS bookingId, kind FROM patient_notifications
         WHERE kind LIKE 'reminder_%h' AND booking_id IN (SELECT id FROM bookings WHERE desired_date = ?)`
      ).bind(date).all<{ bookingId: number; kind: string }>(),
      db.prepare("SELECT phone_normalized AS p FROM patient_profiles WHERE do_not_contact = 1").all<{ p: string }>(),
    ]);
    const alreadySent = new Set((sentRows.results || []).map((r) => `${r.bookingId}:${r.kind}`));
    const dnc = new Set((dncRows.results || []).map((r) => r.p));

    for (const due of dueReminders(leadBookings, leads, alreadySent)) {
      const b = byId.get(due.id);
      if (!b || !b.phoneNormalized) continue;
      const kind = `reminder_${due.hours}h`;
      if (dnc.has(b.phoneNormalized)) {
        await record(db, b, kind, "skipped", "Пацієнт у списку «не турбувати»");
        result.skipped += 1;
        continue;
      }
      const body = leadReminderText(b.service, b.desiredTime, due.hours);
      try {
        const r = await sendWhatsApp(db, b.phoneNormalized, body);
        if (r.ok) { await record(db, b, kind, "sent", ""); result.sent += 1; }
        else { await record(db, b, kind, "failed", r.error || "WhatsApp помилка"); result.failed += 1; }
      } catch (error) {
        await record(db, b, kind, "failed", error instanceof Error ? error.message : "Помилка");
        result.failed += 1;
      }
    }
  } catch {
    // мовчазна відмова — cron не має падати; наступний запуск спробує знову
  }
  return result;
}

async function record(db: D1Database, b: ReminderRow, kind: string, status: string, error: string): Promise<void> {
  const body = leadReminderText(b.service, b.desiredTime, 0);
  await db.prepare(
    `INSERT INTO patient_notifications (booking_id, kind, channel, recipient, body, status, error, sent_at)
     VALUES (?, ?, 'whatsapp', ?, ?, ?, ?, ?)`
  ).bind(b.id, kind, b.phone, body, status, error.slice(0, 240), status).run();
}
