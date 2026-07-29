// Автонагадування пацієнту після підтвердження або перенесення запису.
// Найкраще-зусильна відправка через налаштовувані HTTP-шлюзи SMS / e-mail:
//  • SMS  → на телефон пацієнта;
//  • e-mail → якщо в заявці збережено адресу.
// Кожна спроба фіксується в журналі `patient_notifications` (outbox) і, за
// успіху, в історії комунікацій пацієнта. Ніколи не кидає виняток —
// підтвердження / перенесення не має падати через недоступний шлюз.

import { getSettings } from "./settings";

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

async function record(
  db: D1Database,
  booking: ReminderBooking,
  kind: ReminderKind,
  channel: "sms" | "email",
  recipient: string,
  body: string,
  status: "sent" | "skipped" | "failed",
  error: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO patient_notifications (booking_id, kind, channel, recipient, body, status, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE '' END)`
  ).bind(booking.id, kind, channel, recipient, body, status, error.slice(0, 240), status).run();
  if (status === "sent" && booking.phoneNormalized) {
    await db.prepare(
      `INSERT INTO patient_communications (phone_normalized, channel, direction, summary, actor)
       VALUES (?, ?, 'outbound', ?, 'system')`
    ).bind(booking.phoneNormalized, channel, `Автонагадування (${kind === "confirmed" ? "підтвердження" : "перенесення"}): ${body}`.slice(0, 500)).run();
  }
}

async function postJson(url: string, auth: string, payload: Record<string, string>): Promise<void> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Шлюз відповів ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
  }
}

// Ставить нагадування в чергу і намагається відправити наявними каналами.
// Повертає зведення для UI; помилки каналів не пробрасуються.
export async function sendPatientReminder(
  db: D1Database,
  kind: ReminderKind,
  booking: ReminderBooking,
): Promise<ReminderSummary> {
  const summary: ReminderSummary = { sent: 0, skipped: 0, failed: 0 };
  const body = reminderText(kind, booking);

  const cfg = await getSettings(db, [
    "patient_reminders_enabled",
    "sms_gateway_url", "sms_gateway_auth",
    "email_gateway_url", "email_gateway_auth", "email_gateway_from",
  ]);
  const enabled = truthy(cfg.patient_reminders_enabled || "");

  // Повага до позначки «не турбувати» у картці пацієнта.
  if (booking.phoneNormalized) {
    const profile = await db.prepare(
      "SELECT do_not_contact AS dnc FROM patient_profiles WHERE phone_normalized = ?"
    ).bind(booking.phoneNormalized).first<{ dnc: number }>().catch(() => null);
    if (profile?.dnc) {
      await record(db, booking, kind, "sms", booking.phone, body, "skipped", "Пацієнт у списку «не турбувати»");
      summary.skipped += 1;
      return summary;
    }
  }

  const channels: Array<{ channel: "sms" | "email"; recipient: string; url: string; send: () => Promise<void> }> = [];
  if (booking.phone) {
    channels.push({
      channel: "sms", recipient: booking.phone, url: cfg.sms_gateway_url || "",
      send: () => postJson(cfg.sms_gateway_url, cfg.sms_gateway_auth || "", { to: booking.phone, text: body }),
    });
  }
  if (booking.patientEmail) {
    channels.push({
      channel: "email", recipient: booking.patientEmail, url: cfg.email_gateway_url || "",
      send: () => postJson(cfg.email_gateway_url, cfg.email_gateway_auth || "", {
        to: booking.patientEmail,
        from: cfg.email_gateway_from || "",
        subject: kind === "confirmed" ? "Запис підтверджено" : "Запис перенесено",
        text: body,
      }),
    });
  }

  for (const ch of channels) {
    if (!enabled) {
      await record(db, booking, kind, ch.channel, ch.recipient, body, "skipped", "Нагадування вимкнено в налаштуваннях");
      summary.skipped += 1;
      continue;
    }
    if (!ch.url) {
      await record(db, booking, kind, ch.channel, ch.recipient, body, "skipped", `Шлюз ${ch.channel.toUpperCase()} не налаштовано`);
      summary.skipped += 1;
      continue;
    }
    try {
      await ch.send();
      await record(db, booking, kind, ch.channel, ch.recipient, body, "sent", "");
      summary.sent += 1;
    } catch (error) {
      await record(db, booking, kind, ch.channel, ch.recipient, body, "failed", error instanceof Error ? error.message : "Помилка відправлення");
      summary.failed += 1;
    }
  }
  return summary;
}
