// Вмикає Telegram-канал для пацієнтів: реєструє webhook бота на наш публічний
// ендпоінт із секретним заголовком. Лише для адміністратора.

import { requireStaff } from "../../../../../lib/staff-auth";
import { getSettings, setSetting } from "../../../../../lib/settings";
import { setTelegramWebhook, telegramBotUsername } from "../../../../../lib/telegram";
import { newSessionToken } from "../../../../../lib/auth";
import { dbBinding } from "../../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Доступно лише адміністратору" }, { status: 403 });

  const { telegram_bot_token: token, telegram_webhook_secret: existing } =
    await getSettings(db, ["telegram_bot_token", "telegram_webhook_secret"]);
  if (!token) return Response.json({ error: "Спочатку збережіть токен бота Telegram" }, { status: 400 });

  const secret = existing || newSessionToken();
  const webhookUrl = `${new URL(request.url).origin}/api/telegram/webhook`;
  const result = await setTelegramWebhook(db, webhookUrl, secret);
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося зареєструвати webhook" }, { status: 400 });

  if (!existing) await setSetting(db, "telegram_webhook_secret", secret);
  const username = await telegramBotUsername(db);
  return Response.json({ ok: true, username });
}
