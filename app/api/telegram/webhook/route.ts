// Публічний webhook Telegram. Кожен бот реєструється на URL з ?org=<id>;
// без параметра зберігається legacy-сумісність з організацією 1.

import { getTenantSettings } from "../../../../lib/tenant-settings";
import { handleTelegramUpdate } from "../../../../lib/telegram-link";
import { sendTelegramTo } from "../../../../lib/telegram";
import { dbBinding } from "../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return new Response("ok");
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("org") || "1");
  if (!Number.isInteger(organizationId) || organizationId <= 0) return new Response("forbidden", { status: 401 });

  const { telegram_webhook_secret: secret } = await getTenantSettings(db, ["telegram_webhook_secret"], organizationId);
  const provided = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!secret || provided !== secret) return new Response("forbidden", { status: 401 });

  const update = await request.json().catch(() => ({}));
  const { chatId, reply } = await handleTelegramUpdate(db, update);
  if (chatId && reply) {
    await sendTelegramTo(db, chatId, reply, organizationId).catch(() => ({ ok: false }));
  }
  return new Response("ok");
}
