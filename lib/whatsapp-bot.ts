// Чисті (без залежностей) функції бота й розбору вебхука green-api —
// винесено окремо, щоб бути напряму тестованими.

export type BotAction = "menu" | "appointments" | "booking" | "info" | "human" | null;

export function interpretBotCommand(text: string): BotAction {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return "menu";
  if (["меню", "menu", "привіт", "привет", "hi", "hello", "старт", "start", "0"].includes(t)) return "menu";
  if (t === "1") return "appointments";
  if (t === "2") return "booking";
  if (t === "3") return "info";
  if (t === "4") return "human";
  return null; // не з меню — передаємо персоналу, автовідповіді немає
}

export function menuText(): string {
  return [
    "Вітаємо! Оберіть дію, надіславши цифру:",
    "1 — Мої найближчі записи",
    "2 — Записатися на дослідження",
    "3 — Адреса, години роботи та ціни",
    "4 — Звʼязатися з адміністратором",
  ].join("\n");
}

type IncomingWebhook = {
  typeWebhook?: string;
  idMessage?: string;
  senderData?: { chatId?: string; senderName?: string };
  messageData?: {
    textMessageData?: { textMessage?: string };
    extendedTextMessageData?: { text?: string };
  };
};

export type IncomingMessage = { phoneNormalized: string; text: string; idMessage: string; senderName: string };

export function parseIncomingWebhook(body: unknown): IncomingMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as IncomingWebhook;
  if (b.typeWebhook !== "incomingMessageReceived") return null;
  const phoneNormalized = String(b.senderData?.chatId || "").replace(/@c\.us$/, "").replace(/\D/g, "");
  if (!/^380\d{9}$/.test(phoneNormalized)) return null;
  const text = String(
    b.messageData?.textMessageData?.textMessage ?? b.messageData?.extendedTextMessageData?.text ?? "",
  ).trim().slice(0, 2000);
  return {
    phoneNormalized,
    text,
    idMessage: String(b.idMessage || "").slice(0, 120),
    senderName: String(b.senderData?.senderName || "").slice(0, 120),
  };
}
