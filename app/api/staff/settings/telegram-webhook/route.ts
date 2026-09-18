// Enables the patient Telegram channel for the current organization by
// registering this installation's public webhook with an organization-scoped
// secret. Authorization follows the same system control plane as integration
// settings; medical roles do not gain integration-administration privileges.

import { canManageSystem } from "../../../../../lib/staff-auth";
import { requireSystemOrgContext } from "../../../../../lib/tenant";
import {
  getOrganizationIntegrationSettings,
  setOrganizationIntegrationSetting,
} from "../../../../../lib/settings";
import { setTelegramWebhook, telegramBotUsername } from "../../../../../lib/telegram";
import { newSessionToken } from "../../../../../lib/auth";
import { dbBinding } from "../../../../../lib/db";
import { audit } from "../../../../../lib/audit";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageSystem(ctx.role)) {
    return Response.json({ error: "Доступно лише системному адміністратору організації" }, { status: 403 });
  }

  const { telegram_bot_token: token, telegram_webhook_secret: existing } =
    await getOrganizationIntegrationSettings(
      db,
      ctx.organizationId,
      ["telegram_bot_token", "telegram_webhook_secret"],
    );
  if (!token) return Response.json({ error: "Спочатку збережіть токен бота Telegram" }, { status: 400 });

  const secret = existing || newSessionToken();
  const webhookUrl = `${new URL(request.url).origin}/api/telegram/webhook`;
  const result = await setTelegramWebhook(db, webhookUrl, secret, ctx.organizationId);
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося зареєструвати webhook" }, { status: 400 });

  if (!existing) {
    await setOrganizationIntegrationSetting(
      db,
      ctx.organizationId,
      "telegram_webhook_secret",
      secret,
      ctx.member.email,
    );
  }
  const username = await telegramBotUsername(db, ctx.organizationId);
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "telegram_webhook_enable",
    resource: "settings",
    details: { scope: "organization_integrations" },
  });
  return Response.json({ ok: true, username });
}
