// Sends a test message to the department Telegram chat using the saved
// settings, so an admin can verify the bot token and chat id in one click.
// Telegram bot settings are legacy-global, so only org 1 may use them.

import { requireOrgContext } from "../../../../../lib/tenant";
import { sendTelegramResult } from "../../../../../lib/telegram";
import { dbBinding } from "../../../../../lib/db";

const PRIMARY_ORGANIZATION_ID = 1;

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.organizationId !== PRIMARY_ORGANIZATION_ID || ctx.role !== "admin") {
    return Response.json({ error: "Доступно лише адміністратору основної організації" }, { status: 403 });
  }

  const text = "✅ <b>RadiologyOS</b>\nТестове повідомлення. Сповіщення про заявки налаштовано правильно.";
  const result = await sendTelegramResult(db, text);
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося надіслати" }, { status: 400 });
  return Response.json({ ok: true });
}
