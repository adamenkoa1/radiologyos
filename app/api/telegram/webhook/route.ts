// Public Telegram webhook. The bot API secret resolves exactly one organization;
// duplicate or stale secrets fail closed. Patient links can then bind only to
// that bot's tenant.

import { resolveOrganizationByIntegrationSecret } from "../../../../lib/settings";
import { handleTelegramUpdate } from "../../../../lib/telegram-link";
import { answerTelegramCallback, sendTelegramTo } from "../../../../lib/telegram";
import { handleTelegramBookingAction } from "../../../../lib/telegram-booking-actions";
import { dbBinding } from "../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return new Response("ok");
  const provided = request.headers.get("x-telegram-bot-api-secret-token") || "";
  const organizationId = await resolveOrganizationByIntegrationSecret(db, "telegram_webhook_secret", provided);
  if (!organizationId) return new Response("forbidden", { status: 401 });

  const update = await request.json().catch(() => ({})) as {
    message?: { chat?: { id?:number|string }; text?:string };
    callback_query?: {
      id?:string;
      data?:string;
      from?:{ id?:number|string };
      message?:{ chat?:{ id?:number|string } };
    };
  };
  if (update.callback_query) {
    const result = await handleTelegramBookingAction(db, update.callback_query, organizationId);
    if (result.handled) {
      await answerTelegramCallback(db, result.callbackId, result.message, !result.ok, organizationId);
      if (result.chatId && result.ok) {
        await sendTelegramTo(db, result.chatId, result.message, organizationId).catch(() => ({ ok:false }));
      }
      return new Response("ok");
    }
  }
  const { chatId, reply } = await handleTelegramUpdate(db, update, organizationId);
  if (chatId && reply) {
    await sendTelegramTo(db, chatId, reply, organizationId).catch(() => ({ ok: false }));
  }
  return new Response("ok");
}
