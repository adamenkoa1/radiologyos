// Публічний webhook бота Telegram. Приймає оновлення (натискання «Старт» із
// токеном) і прив'язує chat_id до пацієнта. Захищено секретним заголовком, який
// ми задали у setWebhook — сторонні запити відхиляються.

import { getSettings } from "../../../../lib/settings";
import { handleTelegramUpdate } from "../../../../lib/telegram-link";
import { sendTelegramTo } from "../../../../lib/telegram";
import { dbBinding } from "../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return new Response("ok"); // best-effort: не даємо Telegram ретраїти вічно
  const { telegram_webhook_secret: secret } = await getSettings(db, ["telegram_webhook_secret"]);
  const provided = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!secret || provided !== secret) {
    return new Response("forbidden", { status: 401 });
  }

  const update = await request.json().catch(() => ({}));
  const { chatId, reply } = await handleTelegramUpdate(db, update);
  if (chatId && reply) {
    await sendTelegramTo(db, chatId, reply).catch(() => ({ ok: false }));
  }
  return new Response("ok");
}
