// Вмикає Telegram-канал для пацієнтів конкретної організації.

import { requireOrgContext } from "../../../../../lib/tenant";
import { getTenantSettings, setTenantSetting } from "../../../../../lib/tenant-settings";
import { setTelegramWebhook, telegramBotUsername } from "../../../../../lib/telegram";
import { newSessionToken } from "../../../../../lib/auth";
import { dbBinding } from "../../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.member.role !== "admin") return Response.json({ error: "Доступно лише адміністратору" }, { status: 403 });

  const orgId = ctx.organizationId;
  const { telegram_bot_token: token, telegram_webhook_secret: existing } =
    await getTenantSettings(db, ["telegram_bot_token", "telegram_webhook_secret"], orgId);
  if (!token) return Response.json({ error: "Спочатку збережіть токен бота Telegram" }, { status: 400 });

  const secret = existing || newSessionToken();
  const webhookUrl = new URL("/api/telegram/webhook", new URL(request.url).origin);
  webhookUrl.searchParams.set("org", String(orgId));
  const result = await setTelegramWebhook(db, webhookUrl.toString(), secret, orgId);
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося зареєструвати webhook" }, { status: 400 });

  if (!existing) await setTenantSetting(db, "telegram_webhook_secret", secret, orgId);
  const username = await telegramBotUsername(db, orgId);
  return Response.json({ ok: true, username });
}
