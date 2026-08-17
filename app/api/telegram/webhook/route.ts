// Public Telegram webhook. The bot API secret resolves exactly one organization;
// duplicate or stale secrets fail closed. Patient links can then bind only to
// that bot's tenant.

import { resolveOrganizationByIntegrationSecret } from "../../../../lib/settings";
import { handleTelegramUpdate } from "../../../../lib/telegram-link";
import { sendTelegramTo } from "../../../../lib/telegram";
import { dbBinding } from "../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return new Response("ok");
  const provided = request.headers.get("x-telegram-bot-api-secret-token") || "";
  const organizationId = await resolveOrganizationByIntegrationSecret(db, "telegram_webhook_secret", provided);
  if (!organizationId) return new Response("forbidden", { status: 401 });

  const update = await request.json().catch(() => ({}));
  const { chatId, reply } = await handleTelegramUpdate(db, update, organizationId);
  if (chatId && reply) {
    await sendTelegramTo(db, chatId, reply, organizationId).catch(() => ({ ok: false }));
  }
  return new Response("ok");
}
