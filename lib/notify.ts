// Автонагадування пацієнту після підтвердження або перенесення запису.
// Найкраще-зусильна відправка через налаштовувані HTTP-шлюзи SMS / e-mail:
//  • SMS  → на телефон пацієнта;
//  • e-mail → якщо в заявці збережено адресу.
// Кожна спроба фіксується в журналі `patient_notifications` (outbox) і, за
// успіху, в історії комунікацій пацієнта. Ніколи не кидає виняток —
// підтвердження / перенесення не має падати через недоступний шлюз.

import { getSettings } from "./settings";
import { createMessagingProvider } from "./providers/messaging";
import { sendWhatsApp, whatsappConfig, whatsappConfigured } from "./whatsapp";
import { sendTelegramTo } from "./telegram";

type Channel = "sms" | "email" | "whatsapp" | "telegram";

export type ReminderKind = "confirmed" | "rescheduled";

export interface ReminderBooking {
  id: number;
  name: string;
  phone: string;
  phoneNormalized: string;
  patientEmail: string;
  service: string;
  desiredDate: string;
  desiredTime: string;
}

export interface ReminderSummary {
  sent: number;
  skipped: number;
  failed: number;
}

const DEPARTMENT = "Відділення променевої діагностики, Чернігівський військовий госпіталь";

export function reminderText(kind: ReminderKind, booking: ReminderBooking): string {
  const when = `${booking.desiredDate}${booking.desiredTime ? ` о ${booking.desiredTime}` : ""}`;
  const lead = kind === "confirmed"
    ? `Ваш запис на «${booking.service}» підтверджено`
    : `Ваш запис на «${booking.service}» перенесено`;
  return `${lead}: ${when}. ${DEPARTMENT}. Якщо час не підходить — зателефонуйте у реєстратуру.`;
}

function truthy(value: string): boolean {
  return ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
}

async function bookingOrganizationId(db: D1Database, bookingId: number): Promise<number> {
  const row = await db.prepare(
    "SELECT organization_id AS organizationId FROM bookings WHERE id = ? LIMIT 1"
  ).bind(bookingId).first<{ organizationId: number }>().catch(() => null);
  const id = Number(row?.organizationId || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

async function record(
  db: D1Database,
  organizationId: number,
  booking: ReminderBooking,
  kind: string,
  channel: Channel,
  recipient: string,
  body: string,
  status: "sent" | "skipped" | "failed",
  error: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO patient_notifications
       (organization_id, booking_id, kind, channel, recipient, body, status, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE '' END)`
  ).bind(organizationId, booking.id, kind, channel, recipient, body, status, error.slice(0, 240), status).run();
  if (status === "sent" && booking.phoneNormalized) {
    const label = kind === "confirmed" ? "Автонагадування (підтвердження)"
      : kind === "rescheduled" ? "Автонагадування (перенесення)"
        : "Повідомлення персоналу";
    await db.prepare(
      `INSERT INTO patient_communications
         (organization_id, phone_normalized, channel, direction, summary, actor)
       VALUES (?, ?, ?, 'outbound', ?, 'system')`
    ).bind(organizationId, booking.phoneNormalized, channel, `${label}: ${body}`.slice(0, 500)).run();
  }
}

async function patientMessagingProfile(
  db: D1Database,
  organizationId: number,
  phoneNormalized: string,
): Promise<{ dnc: number; tg: string } | null> {
  if (!phoneNormalized || !organizationId) return null;
  return db.prepare(
    `SELECT do_not_contact AS dnc, telegram_chat_id AS tg
     FROM patient_profiles
     WHERE organization_id = ? AND phone_normalized = ? LIMIT 1`
  ).bind(organizationId, phoneNormalized).first<{ dnc: number; tg: string }>().catch(() => null);
}

// Ставить нагадування в чергу і намагається відправити наявними каналами.
// Повертає зведення для UI; помилки каналів не пробрасуються.
export async function sendPatientReminder(
  db: D1Database,
  kind: ReminderKind,
  booking: ReminderBooking,
): Promise<ReminderSummary> {
  const summary: ReminderSummary = { sent: 0, skipped: 0, failed: 0 };
  const organizationId = await bookingOrganizationId(db, booking.id);
  if (!organizationId) return summary;
  const body = reminderText(kind, booking);

  const cfg = await getSettings(db, [
    "patient_reminders_enabled", "telegram_bot_token",
    "sms_gateway_url", "sms_gateway_auth",
    "email_gateway_url", "email_gateway_auth", "email_gateway_from",
  ]);
  const enabled = truthy(cfg.patient_reminders_enabled || "");

  const messaging = createMessagingProvider({
    sms: { url: cfg.sms_gateway_url || "", auth: cfg.sms_gateway_auth || "" },
    email: { url: cfg.email_gateway_url || "", auth: cfg.email_gateway_auth || "", from: cfg.email_gateway_from || "" },
  });

  let telegramChatId = "";
  if (booking.phoneNormalized) {
    const profile = await patientMessagingProfile(db, organizationId, booking.phoneNormalized);
    if (profile?.dnc) {
      await record(db, organizationId, booking, kind, "sms", booking.phone, body, "skipped", "Пацієнт у списку «не турбувати»");
      summary.skipped += 1;
      return summary;
    }
    telegramChatId = profile?.tg || "";
  }

  const channels: Array<{ channel: Channel; recipient: string; url: string; send: () => Promise<void> }> = [];
  if (telegramChatId) {
    channels.push({
      channel: "telegram", recipient: "Telegram", url: cfg.telegram_bot_token ? telegramChatId : "",
      send: async () => { const r = await sendTelegramTo(db, telegramChatId, body); if (!r.ok) throw new Error(r.error || "Telegram помилка"); },
    });
  }
  const wa = await whatsappConfig(db);
  if (booking.phoneNormalized && whatsappConfigured(wa) && wa.enabled) {
    channels.push({
      channel: "whatsapp", recipient: booking.phone, url: wa.idInstance,
      send: async () => { const r = await sendWhatsApp(db, booking.phoneNormalized, body); if (!r.ok) throw new Error(r.error || "WhatsApp помилка"); },
    });
  }
  if (booking.phone) {
    channels.push({
      channel: "sms", recipient: booking.phone, url: cfg.sms_gateway_url || "",
      send: () => messaging.sendSms(booking.phone, body),
    });
  }
  if (booking.patientEmail) {
    channels.push({
      channel: "email", recipient: booking.patientEmail, url: cfg.email_gateway_url || "",
      send: () => messaging.sendEmail(
        booking.patientEmail,
        kind === "confirmed" ? "Запис підтверджено" : "Запис перенесено",
        body,
      ),
    });
  }

  for (const ch of channels) {
    if (!enabled) {
      await record(db, organizationId, booking, kind, ch.channel, ch.recipient, body, "skipped", "Нагадування вимкнено в налаштуваннях");
      summary.skipped += 1;
      continue;
    }
    if (!ch.url) {
      await record(db, organizationId, booking, kind, ch.channel, ch.recipient, body, "skipped", `Шлюз ${ch.channel.toUpperCase()} не налаштовано`);
      summary.skipped += 1;
      continue;
    }
    try {
      await ch.send();
      await record(db, organizationId, booking, kind, ch.channel, ch.recipient, body, "sent", "");
      summary.sent += 1;
    } catch (error) {
      await record(db, organizationId, booking, kind, ch.channel, ch.recipient, body, "failed", error instanceof Error ? error.message : "Помилка відправлення");
      summary.failed += 1;
    }
  }
  return summary;
}

// Разове повідомлення пацієнту, ініційоване персоналом (не автонагадування).
// Завжди намагається відправити (не залежить від patient_reminders_enabled),
// але поважає «не турбувати» й наявність шлюзів. Ніколи не кидає виняток.
export async function sendPatientMessage(
  db: D1Database,
  booking: ReminderBooking,
  text: string,
): Promise<ReminderSummary> {
  const summary: ReminderSummary = { sent: 0, skipped: 0, failed: 0 };
  const organizationId = await bookingOrganizationId(db, booking.id);
  if (!organizationId) return summary;
  const body = (text || "").trim();
  if (!body) return summary;

  const cfg = await getSettings(db, [
    "telegram_bot_token",
    "sms_gateway_url", "sms_gateway_auth",
    "email_gateway_url", "email_gateway_auth", "email_gateway_from",
  ]);
  const messaging = createMessagingProvider({
    sms: { url: cfg.sms_gateway_url || "", auth: cfg.sms_gateway_auth || "" },
    email: { url: cfg.email_gateway_url || "", auth: cfg.email_gateway_auth || "", from: cfg.email_gateway_from || "" },
  });

  let telegramChatId = "";
  if (booking.phoneNormalized) {
    const profile = await patientMessagingProfile(db, organizationId, booking.phoneNormalized);
    if (profile?.dnc) {
      await record(db, organizationId, booking, "custom", "sms", booking.phone, body, "skipped", "Пацієнт у списку «не турбувати»");
      summary.skipped += 1;
      return summary;
    }
    telegramChatId = profile?.tg || "";
  }

  const channels: Array<{ channel: Channel; recipient: string; url: string; send: () => Promise<void> }> = [];
  if (telegramChatId) {
    channels.push({
      channel: "telegram", recipient: "Telegram", url: cfg.telegram_bot_token ? telegramChatId : "",
      send: async () => { const r = await sendTelegramTo(db, telegramChatId, body); if (!r.ok) throw new Error(r.error || "Telegram помилка"); },
    });
  }
  const wa = await whatsappConfig(db);
  if (booking.phoneNormalized && whatsappConfigured(wa) && wa.enabled) {
    channels.push({
      channel: "whatsapp", recipient: booking.phone, url: wa.idInstance,
      send: async () => { const r = await sendWhatsApp(db, booking.phoneNormalized, body); if (!r.ok) throw new Error(r.error || "WhatsApp помилка"); },
    });
  }
  if (booking.phone) {
    channels.push({ channel: "sms", recipient: booking.phone, url: cfg.sms_gateway_url || "", send: () => messaging.sendSms(booking.phone, body) });
  }
  if (booking.patientEmail) {
    channels.push({ channel: "email", recipient: booking.patientEmail, url: cfg.email_gateway_url || "", send: () => messaging.sendEmail(booking.patientEmail, "Повідомлення з відділення", body) });
  }

  for (const ch of channels) {
    if (!ch.url) {
      await record(db, organizationId, booking, "custom", ch.channel, ch.recipient, body, "skipped", `Шлюз ${ch.channel.toUpperCase()} не налаштовано`);
      summary.skipped += 1;
      continue;
    }
    try {
      await ch.send();
      await record(db, organizationId, booking, "custom", ch.channel, ch.recipient, body, "sent", "");
      summary.sent += 1;
    } catch (error) {
      await record(db, organizationId, booking, "custom", ch.channel, ch.recipient, body, "failed", error instanceof Error ? error.message : "Помилка відправлення");
      summary.failed += 1;
    }
  }
  return summary;
}
