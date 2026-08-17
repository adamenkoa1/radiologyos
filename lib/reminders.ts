// Планові нагадування пацієнтам за N годин до візиту.
// Раннер завжди отримує явний tenant і використовує тільки його integration settings.

import { getOrganizationIntegrationSettings } from "./settings";
import { sendWhatsApp, whatsappConfig, whatsappConfigured } from "./whatsapp";
import {
  REMINDER_LEAD_KEY, dueReminders, kyivNow, leadReminderText, minutesOfTime,
  parseLeadHours, type LeadBooking,
} from "./reminders-core";

export { REMINDER_LEAD_KEY, parseLeadHours };

type ReminderRow = {
  id: number; patientId:string; name: string; phone: string; phoneNormalized: string;
  service: string; desiredTime: string; doNotContact:number; sharedProfileCount:number;
  staleLinkedContact:number;
};

export async function runDueReminders(
  db: D1Database,
  nowMs: number,
  organizationId: number,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!Number.isInteger(organizationId) || organizationId <= 0) return result;
  try {
    const cfg = await getOrganizationIntegrationSettings(db, organizationId, [
      "patient_reminders_enabled", REMINDER_LEAD_KEY,
    ]);
    if (!["1", "true", "on", "yes"].includes((cfg.patient_reminders_enabled || "").trim().toLowerCase())) {
      return result;
    }
    const wa = await whatsappConfig(db, organizationId);
    if (!whatsappConfigured(wa) || !wa.enabled) return result;

    const leads = parseLeadHours(cfg[REMINDER_LEAD_KEY]);
    const { date, minutes: nowMin } = kyivNow(nowMs);

    const rows = await db.prepare(
      `SELECT b.id, b.patient_id AS patientId, b.name, b.phone,
         b.phone_normalized AS phoneNormalized, b.service, b.desired_time AS desiredTime,
         CASE
           WHEN b.patient_id != '' AND EXISTS (
             SELECT 1 FROM patient_profiles p
             WHERE p.organization_id = b.organization_id
               AND p.patient_id = b.patient_id
               AND p.do_not_contact = 1
           ) THEN 1 ELSE 0 END AS doNotContact,
         CASE WHEN b.patient_id = '' THEN (
           SELECT COUNT(*) FROM patient_profiles p
           WHERE p.organization_id = b.organization_id
             AND p.phone_normalized = b.phone_normalized
         ) ELSE 0 END AS sharedProfileCount,
         CASE
           WHEN b.patient_id != '' AND NOT EXISTS (
             SELECT 1 FROM patient_profiles p
             WHERE p.organization_id = b.organization_id
               AND p.patient_id = b.patient_id
               AND p.phone_normalized = b.phone_normalized
           ) THEN 1 ELSE 0 END AS staleLinkedContact
       FROM bookings b
       WHERE b.organization_id = ? AND b.desired_date = ? AND b.status IN ('confirmed','rescheduled')`
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

    const sentRows = await db.prepare(
      `SELECT n.booking_id AS bookingId, n.kind
       FROM patient_notifications n
       JOIN bookings b ON b.id = n.booking_id
       WHERE b.organization_id = ? AND n.kind LIKE 'reminder_%h' AND b.desired_date = ?`
    ).bind(organizationId, date).all<{ bookingId: number; kind: string }>();
    const alreadySent = new Set((sentRows.results || []).map((r) => `${r.bookingId}:${r.kind}`));

    for (const due of dueReminders(leadBookings, leads, alreadySent)) {
      const b = byId.get(due.id);
      if (!b || !b.phoneNormalized) continue;
      const kind = `reminder_${due.hours}h`;
      if (b.doNotContact || b.staleLinkedContact || (!b.patientId && b.sharedProfileCount > 0)) {
        const reason = b.doNotContact
          ? "Пацієнт у списку «не турбувати»"
          : b.staleLinkedContact
            ? "Контакт exact-пацієнта змінено після створення запису"
            : "Неприв’язаний запис має неоднозначну CRM-ідентичність";
        await record(db, organizationId, b, kind, "skipped", reason);
        result.skipped += 1;
        continue;
      }
      const body = leadReminderText(b.service, b.desiredTime, due.hours);
      try {
        const r = await sendWhatsApp(db, organizationId, b.phoneNormalized, body);
        if (r.ok) { await record(db, organizationId, b, kind, "sent", ""); result.sent += 1; }
        else { await record(db, organizationId, b, kind, "failed", r.error || "WhatsApp помилка"); result.failed += 1; }
      } catch (error) {
        await record(db, organizationId, b, kind, "failed", error instanceof Error ? error.message : "Помилка");
        result.failed += 1;
      }
    }
  } catch {
    // Cron must fail closed for this tenant and retry on the next run.
  }
  return result;
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
