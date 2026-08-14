// Прив'язка Telegram пацієнта: короткоживучі токени для deep-link «Старт»
// і обробник вхідних оновлень від бота (webhook). Пацієнт натискає «Старт»
// у боті один раз — ми зіставляємо токен із tenant + телефоном і зберігаємо chat_id.

import { hashToken, newSessionToken } from "./auth";

export const TELEGRAM_LINK_TTL_SECONDS = 15 * 60;

export async function createTelegramLinkToken(
  db: D1Database,
  phoneNormalized: string,
  organizationId: number,
): Promise<string> {
  const rawToken = newSessionToken();
  const tokenHash = await hashToken(rawToken);
  await db.prepare(
    `INSERT INTO telegram_link_tokens (token_hash, organization_id, phone_normalized, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`
  ).bind(tokenHash, organizationId, phoneNormalized, `+${TELEGRAM_LINK_TTL_SECONDS} seconds`).run();
  await db.prepare("DELETE FROM telegram_link_tokens WHERE expires_at <= CURRENT_TIMESTAMP").run();
  return rawToken;
}

export async function consumeTelegramLinkToken(
  db: D1Database,
  rawToken: string,
): Promise<{ organizationId: number; phone: string } | null> {
  const token = String(rawToken || "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  const row = await db.prepare(
    `SELECT organization_id AS organizationId, phone_normalized AS phone
     FROM telegram_link_tokens
     WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP LIMIT 1`
  ).bind(tokenHash).first<{ organizationId: number; phone: string }>().catch(() => null);
  await db.prepare("DELETE FROM telegram_link_tokens WHERE token_hash = ?").bind(tokenHash).run();
  return row || null;
}

export async function linkPatientTelegram(
  db: D1Database,
  organizationId: number,
  phoneNormalized: string,
  chatId: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO patient_profiles (organization_id, phone_normalized, telegram_chat_id, updated_by, updated_at)
     VALUES (?, ?, ?, 'telegram', CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id, phone_normalized) DO UPDATE SET
       telegram_chat_id = excluded.telegram_chat_id, updated_by = 'telegram', updated_at = CURRENT_TIMESTAMP`
  ).bind(organizationId, phoneNormalized, chatId).run();
}

// /stop is bot-wide consent revocation for this chat. If the same human linked
// the same bot in more than one tenant, remove every matching link.
export async function unlinkPatientTelegram(db: D1Database, chatId: string): Promise<void> {
  await db.prepare(
    "UPDATE patient_profiles SET telegram_chat_id = '', updated_at = CURRENT_TIMESTAMP WHERE telegram_chat_id = ?"
  ).bind(chatId).run();
}

interface TelegramUpdate {
  message?: { chat?: { id?: number | string }; text?: string };
}

export async function handleTelegramUpdate(db: D1Database, update: TelegramUpdate): Promise<{ chatId: string; reply: string }> {
  const chatId = update?.message?.chat?.id != null ? String(update.message.chat.id) : "";
  const text = (update?.message?.text || "").trim();
  if (!chatId || !text) return { chatId: "", reply: "" };

  if (/^\/stop\b/.test(text)) {
    await unlinkPatientTelegram(db, chatId);
    return { chatId, reply: "Ви відписались від сповіщень. Щоб знову підключити — натисніть кнопку в кабінеті." };
  }

  const m = text.match(/^\/start\s+([a-f0-9]{64})$/);
  if (!m) {
    return { chatId, reply: "Щоб підключити сповіщення, відкрийте кабінет на сайті й натисніть «Підключити Telegram»." };
  }
  const target = await consumeTelegramLinkToken(db, m[1]);
  if (!target) {
    return { chatId, reply: "Посилання застаріло. Відкрийте кабінет і натисніть «Підключити Telegram» ще раз." };
  }
  await linkPatientTelegram(db, target.organizationId, target.phone, chatId);
  return { chatId, reply: "✅ Готово! Сповіщення про ваші дослідження надходитимуть у цей чат." };
}
