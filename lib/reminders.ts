// Планові нагадування пацієнтам за N годин до візиту.

import { getTenantSettings } from "./tenant-settings";
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

export async function runDueReminders(
  db: D1Database,
  nowMs: number,
  organizationId: number,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!Number.isInteger(organizationId) || organizationId <= 0) return result;
  try {
    const cfg = await getTenantSettings(db, ["patient_reminders_enabled", REMINDER_LEAD_KEY], organizationId);
    if (!["1", "true", "on", "yes"].includes((cfg.patient_reminders_enabled || "").trim().toLowerCase())) return result;
    const wa = await whatsappConfig(db, organizationId);
    if (!whatsappConfigured(wa) || !wa.enabled) return result;

    const leads = parseLeadHours(cfg[REMINDER_LEAD_KEY]);
    const { date, minutes: nowMin } = kyivNow(nowMs);
    const rows = await db.prepare(
      `SELECT id, name, phone, phone_normalized AS phoneNormalized, service, desired_time AS desiredTime
       FROM bookings
       WHERE organization_id = ? AND desired_date = ? AND status IN ('confirmed','rescheduled')`
    ).bind(organizationId, date).all<ReminderRow>();
    const bookings = rows.results || [];
    if (!bookings.length) return result;

    const leadBookings: LeadBooking[] = [];
    const byId = new Map<number, ReminderRow>();
    for (const b of bookings) {
      const t = minutesOfTime(b.desiredTime);
      if (t == null) continue;
      byId.set(b.id, b);
      leadBookings.push({ id: b.id, minutesUntil: t - nowMin });
    }

    const [sentRows, dncRows] = await Promise.all([
      db.prepare(
        `SELECT n.booking_id AS bookingId, n.kind
         FROM patient_notifications n
         JOIN bookings b ON b.id = n.booking_id
         WHERE n.organization_id = ? AND b.organization_id = ?
           AND n.kind LIKE 'reminder_%h' AND b.desired_date = ?`
      ).bind(organizationId, organizationId, date).all<{ bookingId: number; kind: string }>(),
      db.prepare(
        "SELECT phone_normalized AS p FROM patient_profiles WHERE organization_id = ? AND do_not_contact = 1"
      ).bind(organizationId).all<{ p: string }>(),
    ]);
    const alreadySent = new Set((sentRows.results || []).map((r) => `${r.bookingId}:${r.kind}`));
    const dnc = new Set((dncRows.results || []).map((r) => r.p));

    for (const due of dueReminders(leadBookings, leads, alreadySent)) {
      const b = byId.get(due.id);
      if (!b || !b.phoneNormalized) continue;
      const kind = `reminder_${due.hours}h`;
      if (dnc.has(b.phoneNormalized)) {
        await record(db, organizationId, b, kind, "skipped", "Пацієнт у списку «не турбувати»");
        result.skipped += 1;
        continue;
      }
      const body = leadReminderText(b.service, b.desiredTime, due.hours);
      try {
        const r = await sendWhatsApp(db, b.phoneNormalized, body, organizationId);
        if (r.ok) { await record(db, organizationId, b, kind, "sent", ""); result.sent += 1; }
        else { await record(db, organizationId, b, kind, "failed", r.error || "WhatsApp помилка"); result.failed += 1; }
      } catch (error) {
        await record(db, organizationId, b, kind, "failed", error instanceof Error ? error.message : "Помилка");
        result.failed += 1;
      }
    }
  } catch {
    // cron must not fail; a later invocation retries due reminders
  }
  return result;
}

export async function runDueRemindersForActiveOrganizations(
  db: D1Database,
  nowMs: number,
): Promise<void> {
  const organizations = await db.prepare(
    "SELECT id FROM organizations WHERE active = 1 ORDER BY id"
  ).all<{ id: number }>().catch(() => ({ results: [] as { id: number }[] }));
  await Promise.all((organizations.results || []).map((row) => runDueReminders(db, nowMs, Number(row.id))));
}

async function record(
  db: D1Database,
  organizationId: number,
  b: ReminderRow,
  kind: string,
  status: string,
  error: string,
): Promise<void> {
  const body = leadReminderText(b.service, b.desiredTime, 0);
  await db.prepare(
    `INSERT INTO patient_notifications
      (organization_id, booking_id, kind, channel, recipient, body, status, error, sent_at)
     VALUES (?, ?, ?, 'whatsapp', ?, ?, ?, ?, ?)`
  ).bind(organizationId, b.id, kind, b.phone, body, status, error.slice(0, 240), status).run();
}
