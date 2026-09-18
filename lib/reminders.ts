// Планові нагадування пацієнтам за N годин до візиту.
// Раннер завжди отримує явний tenant і використовує тільки його integration settings.
//
// Канали: для кожного запису пробуємо ланцюжок Telegram → e-mail → WhatsApp → SMS
// і зупиняємось на першому успішному (див. reminderChannelChain). Ліди можуть
// перетинати добу (нагадування «напередодні» за 24 год) — запит бере записи на
// сьогодні й завтра, а minutesUntilBooking рахує хвилини через межу доби.

import { getOrganizationIntegrationSettings } from "./settings";
import { createMessagingProvider } from "./providers/messaging";
import { sendTelegramTo } from "./telegram";
import { sendWhatsApp, whatsappConfig, whatsappConfigured } from "./whatsapp";
import {
  REMINDER_LEAD_KEY, addDaysToDate, dueReminders, kyivNow, leadReminderText,
  minutesUntilBooking, parseLeadHours, reminderChannelChain, visitDayLabel,
  type ChannelName, type LeadBooking,
} from "./reminders-core";

export { REMINDER_LEAD_KEY, parseLeadHours };

type ReminderRow = {
  id: number; patientId:string; name: string; phone: string; phoneNormalized: string;
  patientEmail: string; service: string; desiredDate: string; desiredTime: string;
  telegramChatId: string; doNotContact:number; sharedProfileCount:number;
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
      "patient_reminders_enabled", REMINDER_LEAD_KEY, "telegram_bot_token",
      "sms_gateway_url", "sms_gateway_auth",
      "email_gateway_url", "email_gateway_auth", "email_gateway_from",
    ]);
    if (!["1", "true", "on", "yes"].includes((cfg.patient_reminders_enabled || "").trim().toLowerCase())) {
      return result;
    }

    const wa = await whatsappConfig(db, organizationId);
    const waReady = whatsappConfigured(wa) && wa.enabled;
    const telegramToken = (cfg.telegram_bot_token || "").trim();
    const smsUrl = (cfg.sms_gateway_url || "").trim();
    const emailUrl = (cfg.email_gateway_url || "").trim();
    // Жоден канал не налаштовано — нема чим слати, вийти без запису в outbox,
    // щоб нагадування спробувалось знову, коли адмін підключить шлюз.
    if (!telegramToken && !emailUrl && !smsUrl && !waReady) return result;

    const messaging = createMessagingProvider({
      sms: { url: smsUrl, auth: cfg.sms_gateway_auth || "" },
      email: { url: emailUrl, auth: cfg.email_gateway_auth || "", from: cfg.email_gateway_from || "" },
    });

    const leads = parseLeadHours(cfg[REMINDER_LEAD_KEY]);
    const { date, minutes: nowMin } = kyivNow(nowMs);
    const tomorrow = addDaysToDate(date, 1);

    const rows = await db.prepare(
      `SELECT b.id, b.patient_id AS patientId, b.name, b.phone,
         b.phone_normalized AS phoneNormalized, b.patient_email AS patientEmail,
         b.service, b.desired_date AS desiredDate, b.desired_time AS desiredTime,
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
           ) THEN 1 ELSE 0 END AS staleLinkedContact,
         COALESCE((
           SELECT ti.telegram_chat_id
           FROM patient_telegram_identities ti
           WHERE ti.organization_id = b.organization_id
             AND ti.phone_normalized = b.phone_normalized
             AND ti.telegram_chat_id != ''
             AND (
               (b.patient_id != '' AND ti.patient_id = b.patient_id)
               OR (
                 b.patient_id = '' AND ti.patient_id = ''
                 AND ti.identity_kind = 'booking' AND ti.identity_value = b.code
               )
             )
           ORDER BY ti.updated_at DESC
           LIMIT 1
         ), '') AS telegramChatId
       FROM bookings b
       WHERE b.organization_id = ? AND b.desired_date IN (?, ?)
         AND b.status IN ('confirmed','rescheduled')`
    ).bind(organizationId, date, tomorrow).all<ReminderRow>();
    const bookings = rows.results || [];
    if (!bookings.length) return result;

    const leadBookings: LeadBooking[] = [];
    const byId = new Map<number, ReminderRow>();
    for (const b of bookings) {
      const minutesUntil = minutesUntilBooking(date, nowMin, b.desiredDate, b.desiredTime);
      if (minutesUntil == null) continue;
      byId.set(b.id, b);
      leadBookings.push({ id: b.id, minutesUntil });
    }

    const sentRows = await db.prepare(
      `SELECT n.booking_id AS bookingId, n.kind
       FROM patient_notifications n
       JOIN bookings b ON b.id = n.booking_id
       WHERE b.organization_id = ? AND n.kind LIKE 'reminder_%h' AND b.desired_date IN (?, ?)`
    ).bind(organizationId, date, tomorrow).all<{ bookingId: number; kind: string }>();
    const alreadySent = new Set((sentRows.results || []).map((r) => `${r.bookingId}:${r.kind}`));

    for (const due of dueReminders(leadBookings, leads, alreadySent)) {
      const b = byId.get(due.id);
      if (!b || !b.phoneNormalized) continue;
      const kind = `reminder_${due.hours}h`;
      const dayLabel = visitDayLabel(b.desiredDate, date);
      const body = leadReminderText(b.service, b.desiredTime, due.hours, dayLabel);

      if (b.doNotContact || b.staleLinkedContact || (!b.patientId && b.sharedProfileCount > 0)) {
        const reason = b.doNotContact
          ? "Пацієнт у списку «не турбувати»"
          : b.staleLinkedContact
            ? "Контакт exact-пацієнта змінено після створення запису"
            : "Неприв’язаний запис має неоднозначну CRM-ідентичність";
        await record(db, organizationId, b, kind, "whatsapp", b.phone, body, "skipped", reason);
        result.skipped += 1;
        continue;
      }

      const chain = reminderChannelChain({
        telegram: !!b.telegramChatId && !!telegramToken,
        email: !!b.patientEmail && !!emailUrl,
        whatsapp: waReady,
        sms: !!b.phone && !!smsUrl,
      });
      // Немає жодного придатного каналу саме для цього запису — не пишемо в
      // outbox, щоб спробувати ще раз у вікні, якщо зʼявиться контакт/шлюз.
      if (!chain.length) { result.skipped += 1; continue; }

      let delivered = false;
      let lastChannel: ChannelName = chain[chain.length - 1];
      let lastRecipient = b.phone;
      let lastError = "";
      for (const channel of chain) {
        const { recipient, run } = channelSender(channel, b, body, messaging, db, organizationId);
        lastChannel = channel; lastRecipient = recipient;
        try {
          const r = await run();
          if (r.ok) { await record(db, organizationId, b, kind, channel, recipient, body, "sent", ""); delivered = true; break; }
          lastError = r.error || `${channel} помилка`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Помилка відправлення";
        }
      }
      if (delivered) { result.sent += 1; }
      else {
        await record(db, organizationId, b, kind, lastChannel, lastRecipient, body, "failed", lastError || "Усі канали недоступні");
        result.failed += 1;
      }
    }
  } catch {
    // Cron must fail closed for this tenant and retry on the next run.
  }
  return result;
}

function channelSender(
  channel: ChannelName,
  b: ReminderRow,
  body: string,
  messaging: ReturnType<typeof createMessagingProvider>,
  db: D1Database,
  organizationId: number,
): { recipient: string; run: () => Promise<{ ok: boolean; error?: string }> } {
  switch (channel) {
    case "telegram":
      return { recipient: "Telegram", run: () => sendTelegramTo(db, b.telegramChatId, body, organizationId) };
    case "email":
      return {
        recipient: b.patientEmail,
        run: async () => { await messaging.sendEmail(b.patientEmail, "Нагадування про запис", body); return { ok: true }; },
      };
    case "sms":
      return {
        recipient: b.phone,
        run: async () => { await messaging.sendSms(b.phone, body); return { ok: true }; },
      };
    case "whatsapp":
    default:
      return { recipient: b.phone, run: () => sendWhatsApp(db, b.phoneNormalized, body, organizationId) };
  }
}

async function record(
  db: D1Database,
  organizationId: number,
  b: ReminderRow,
  kind: string,
  channel: ChannelName,
  recipient: string,
  body: string,
  status: string,
  error: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO patient_notifications
      (organization_id, booking_id, kind, channel, recipient, body, status, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(organizationId, b.id, kind, channel, recipient, body, status, error.slice(0, 240), status).run();
}
