// Прив'язка Telegram пацієнта: короткоживучі токени для deep-link «Старт»
// і обробник вхідних оновлень від бота (webhook). Пацієнт натискає «Старт»
// у боті один раз — ми зіставляємо токен із його телефоном і зберігаємо chat_id.

import { hashToken, newSessionToken } from "./auth";

export const TELEGRAM_LINK_TTL_SECONDS = 15 * 60;

// Створює токен, прив'язаний до телефону пацієнта; повертає «сирий» токен для
// параметра ?start=. У БД зберігаємо лише SHA-256 хеш (як і сесії).
export async function createTelegramLinkToken(db: D1Database, phoneNormalized: string): Promise<string> {
  const rawToken = newSessionToken();
  const tokenHash = await hashToken(rawToken);
  await db.prepare(
    `INSERT INTO telegram_link_tokens (token_hash, phone_normalized, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  ).bind(tokenHash, phoneNormalized, `+${TELEGRAM_LINK_TTL_SECONDS} seconds`).run();
  await db.prepare("DELETE FROM telegram_link_tokens WHERE expires_at <= CURRENT_TIMESTAMP").run();
  return rawToken;
}

// Одноразово споживає токен: повертає телефон і одразу видаляє запис.
export async function consumeTelegramLinkToken(db: D1Database, rawToken: string): Promise<string> {
  const token = String(rawToken || "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return "";
  const tokenHash = await hashToken(token);
  const row = await db.prepare(
    `SELECT phone_normalized AS phone FROM telegram_link_tokens
     WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP LIMIT 1`
  ).bind(tokenHash).first<{ phone: string }>().catch(() => null);
  await db.prepare("DELETE FROM telegram_link_tokens WHERE token_hash = ?").bind(tokenHash).run();
  return row?.phone || "";
}

// Зберігає chat_id у профілі пацієнта (upsert за нормалізованим телефоном).
export async function linkPatientTelegram(db: D1Database, phoneNormalized: string, chatId: string): Promise<void> {
  await db.prepare(
    `INSERT INTO patient_profiles (phone_normalized, telegram_chat_id, updated_by, updated_at)
     VALUES (?, ?, 'telegram', CURRENT_TIMESTAMP)
     ON CONFLICT(phone_normalized) DO UPDATE SET telegram_chat_id = excluded.telegram_chat_id, updated_at = CURRENT_TIMESTAMP`
  ).bind(phoneNormalized, chatId).run();
}

// Видаляє прив'язку (пацієнт написав /stop).
export async function unlinkPatientTelegram(db: D1Database, chatId: string): Promise<void> {
  await db.prepare(
    "UPDATE patient_profiles SET telegram_chat_id = '', updated_at = CURRENT_TIMESTAMP WHERE telegram_chat_id = ?"
  ).bind(chatId).run();
}

interface TelegramUpdate {
  message?: { chat?: { id?: number | string }; text?: string };
}

// Обробляє одне оновлення від бота. Повертає текст відповіді пацієнту або "".
// Best-effort: не кидає винятків, невідомі команди ігнорує.
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
  const phone = await consumeTelegramLinkToken(db, m[1]);
  if (!phone) {
    return { chatId, reply: "Посилання застаріло. Відкрийте кабінет і натисніть «Підключити Telegram» ще раз." };
  }
  await linkPatientTelegram(db, phone, chatId);
  return { chatId, reply: "✅ Готово! Сповіщення про ваші дослідження надходитимуть у цей чат." };
}
