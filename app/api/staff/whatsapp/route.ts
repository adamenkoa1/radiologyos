// Підключення WhatsApp (green-api) для поточної організації.
// Credentials and webhook secret live in the organization-scoped integration
// store and authorization follows the system control plane.

import { canManageSystem } from "../../../../lib/staff-auth";
import { requireSystemOrgContext } from "../../../../lib/tenant";
import {
  getOrganizationIntegrationSetting,
  setOrganizationIntegrationSetting,
} from "../../../../lib/settings";
import { whatsappConfig, whatsappConfigured } from "../../../../lib/whatsapp";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function ensureWebhookToken(
  db: D1Database,
  organizationId: number,
  actorEmail: string,
): Promise<string> {
  const existing = await getOrganizationIntegrationSetting(db, organizationId, "whatsapp_webhook_token");
  if (existing) return existing;
  const token = crypto.randomUUID().replace(/-/g, "");
  await setOrganizationIntegrationSetting(db, organizationId, "whatsapp_webhook_token", token, actorEmail);
  await audit(db, {
    organizationId,
    actorEmail,
    action: "whatsapp_webhook_secret_create",
    resource: "settings",
    details: { scope: "organization_integrations" },
  });
  return token;
}

async function requireIntegrationAdmin(request: Request, db: D1Database) {
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx || !canManageSystem(ctx.role)) return null;
  return ctx;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireIntegrationAdmin(request, db);
  if (!ctx) return Response.json({ error: "WhatsApp доступний лише системному адміністратору організації" }, { status: 403 });

  const cfg = await whatsappConfig(db, ctx.organizationId);
  const token = await ensureWebhookToken(db, ctx.organizationId, ctx.member.email);
  const origin = new URL(request.url).origin;
  return Response.json({
    settings: {
      idInstance: cfg.idInstance,
      apiTokenSet: Boolean(cfg.apiToken),
      enabled: cfg.enabled,
      connected: whatsappConfigured(cfg),
      webhookUrl: `${origin}/api/whatsapp/webhook?token=${token}`,
    },
    staff: ctx.member,
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireIntegrationAdmin(request, db);
  if (!ctx) return Response.json({ error: "Змінювати WhatsApp може лише системний адміністратор організації" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { idInstance?: string; apiToken?: string; enabled?: boolean };
  const idInstance = clean(body.idInstance, 40);
  const apiToken = clean(body.apiToken, 200);
  const set = (key: string, value: string) =>
    setOrganizationIntegrationSetting(db, ctx.organizationId, key, value, ctx.member.email);

  // Порожнє поле лишає збережене; "-" очищає (як з іншими секретами).
  if (idInstance === "-") await set("whatsapp_id_instance", "");
  else if (idInstance) await set("whatsapp_id_instance", idInstance);
  if (apiToken === "-") await set("whatsapp_api_token_instance", "");
  else if (apiToken) await set("whatsapp_api_token_instance", apiToken);
  await set("whatsapp_enabled", body.enabled ? "1" : "");

  const token = await ensureWebhookToken(db, ctx.organizationId, ctx.member.email);
  const cfg = await whatsappConfig(db, ctx.organizationId);
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "whatsapp_settings_update",
    resource: "settings",
    details: { scope: "organization_integrations" },
  });

  const origin = new URL(request.url).origin;
  return Response.json({
    ok: true,
    settings: {
      idInstance: cfg.idInstance,
      apiTokenSet: Boolean(cfg.apiToken),
      enabled: cfg.enabled,
      connected: whatsappConfigured(cfg),
      webhookUrl: `${origin}/api/whatsapp/webhook?token=${token}`,
    },
  }, { headers: { "cache-control": "no-store" } });
}
