// Emails the registrar when a new public booking arrives. Mirrors the Telegram
// notification but over e-mail: it fires only when the organization has an
// e-mail gateway configured AND a recipient address (booking_notify_email) set.
// Never throws — a booking must still succeed if the mail gateway is down.

import { getOrganizationIntegrationSettings } from "./settings";
import { createMessagingProvider } from "./providers/messaging";

export interface BookingEmailNotice {
  codes: string[];
  name: string;
  phone: string;
  category: "civilian" | "military";
  comment?: string;
  items: { code: string; title: string; date: string; time: string }[];
}

export function bookingEmailBody(notice: BookingEmailNotice): { subject: string; text: string } {
  const subject = `Нова заявка ${notice.codes.join(", ")}`;
  const lines = [
    "Нова заявка на дослідження.",
    `Пацієнт: ${notice.name}`,
    `Телефон: ${notice.phone}`,
    `Категорія: ${notice.category === "military" ? "військовий (безоплатно)" : "цивільний (платно)"}`,
    "",
    "Дослідження:",
    ...notice.items.map((it) => `• ${it.code} ${it.title} — ${it.date}${it.time ? ` о ${it.time}` : ""}`),
    ...(notice.comment ? ["", `Коментар: ${notice.comment}`] : []),
    "",
    `Коди заявок: ${notice.codes.join(", ")}`,
    "Деталі та підтвердження — у захищеному кабінеті персоналу.",
  ];
  return { subject, text: lines.join("\n") };
}

export async function sendBookingEmail(
  db: D1Database,
  organizationId: number,
  notice: BookingEmailNotice,
): Promise<boolean> {
  try {
    const cfg = await getOrganizationIntegrationSettings(db, organizationId, [
      "email_gateway_url", "email_gateway_auth", "email_gateway_from", "booking_notify_email",
    ]);
    const to = cfg.booking_notify_email || "";
    if (!cfg.email_gateway_url || !to) return false;
    const messaging = createMessagingProvider({
      sms: { url: "", auth: "" },
      email: { url: cfg.email_gateway_url, auth: cfg.email_gateway_auth || "", from: cfg.email_gateway_from || "" },
    });
    if (!messaging.capabilities.email) return false;
    const { subject, text } = bookingEmailBody(notice);
    await messaging.sendEmail(to, subject, text);
    return true;
  } catch (error) {
    console.error("booking_email_failed", notice.codes[0], error);
    return false;
  }
}
