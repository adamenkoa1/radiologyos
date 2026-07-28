// Best-effort Telegram notifications for the registrar. Disabled (a no-op)
// until an admin saves a bot token and chat id in /staff/settings.

import { getSettings } from "./settings";

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m] as string));
}

export interface BookingNotice {
  codes: string[];
  name: string;
  phone: string;
  category: string;
  services: string[];
  desiredDate: string;
  desiredTime: string;
  comment?: string;
}

export function bookingMessage(notice: BookingNotice): string {
  const who = notice.category === "military" ? "Військовослужбовець" : "Цивільний пацієнт";
  const when = notice.desiredDate
    ? `${notice.desiredDate}${notice.desiredTime ? ` о ${notice.desiredTime}` : ""}`
    : "не вказано";
  const lines = [
    "🆕 <b>Нова заявка</b>",
    `👤 ${escapeHtml(notice.name)} · ${who}`,
    `📞 ${escapeHtml(notice.phone)}`,
    `🩻 ${notice.services.map(escapeHtml).join("; ")}`,
    `📅 Бажаний час: ${escapeHtml(when)}`,
    `🔖 Код: ${notice.codes.map(escapeHtml).join(", ")}`,
  ];
  if (notice.comment) lines.push(`💬 ${escapeHtml(notice.comment)}`);
  return lines.join("\n");
}

// Sends a message to the department chat and reports the outcome. Returns a
// human-readable Ukrainian error on failure (used by the "send test" button).
export async function sendTelegramResult(db: D1Database, text: string): Promise<{ ok: boolean; error?: string }> {
  const { telegram_bot_token: token, telegram_chat_id: chatId } =
    await getSettings(db, ["telegram_bot_token", "telegram_chat_id"]);
  if (!token || !chatId) return { ok: false, error: "Спочатку збережіть токен бота та ID чату" };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (response.ok) return { ok: true };
    const data = await response.json().catch(() => ({})) as { description?: string };
    return { ok: false, error: data.description || `Telegram відповів помилкою (${response.status})` };
  } catch {
    return { ok: false, error: "Не вдалося з'єднатися з Telegram" };
  }
}

// Best-effort variant for the booking path — never throws, ignores the reason.
export async function sendTelegram(db: D1Database, text: string): Promise<boolean> {
  return (await sendTelegramResult(db, text)).ok;
}
