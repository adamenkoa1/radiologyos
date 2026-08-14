// Підключення WhatsApp (green-api) для конкретної організації.

import { requireOrgContext } from "../../../../lib/tenant";
import { getTenantSettings, getTenantSetting, setTenantSetting } from "../../../../lib/tenant-settings";
import { whatsappConfig, whatsappConfigured } from "../../../../lib/whatsapp";
import { dbBinding } from "../../../../lib/db";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function ensureWebhookToken(db: D1Database, organizationId: number): Promise<string> {
  const existing = await getTenantSetting(db, "whatsapp_webhook_token", organizationId);
  if (existing) return existing;
  const token = crypto.randomUUID().replace(/-/g, "");
  await setTenantSetting(db, "whatsapp_webhook_token", token, organizationId);
  return token;
}

function webhookUrl(request: Request, organizationId: number, token: string): string {
  const url = new URL("/api/whatsapp/webhook", new URL(request.url).origin);
  url.searchParams.set("org", String(organizationId));
  url.searchParams.set("token", token);
  return url.toString();
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.member.role !== "admin") return Response.json({ error: "WhatsApp налаштовує лише адміністратор" }, { status: 403 });

  const cfg = await whatsappConfig(db, ctx.organizationId);
  const token = await ensureWebhookToken(db, ctx.organizationId);
  return Response.json({
    settings: {
      idInstance: cfg.idInstance,
      apiTokenSet: Boolean(cfg.apiToken),
      enabled: cfg.enabled,
      connected: whatsappConfigured(cfg),
      webhookUrl: webhookUrl(request, ctx.organizationId, token),
    },
    staff: ctx.member,
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.member.role !== "admin") return Response.json({ error: "Змінювати WhatsApp може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { idInstance?: string; apiToken?: string; enabled?: boolean };
  const idInstance = clean(body.idInstance, 40);
  const apiToken = clean(body.apiToken, 200);
  const orgId = ctx.organizationId;
  if (idInstance === "-") await setTenantSetting(db, "whatsapp_id_instance", "", orgId);
  else if (idInstance) await setTenantSetting(db, "whatsapp_id_instance", idInstance, orgId);
  if (apiToken === "-") await setTenantSetting(db, "whatsapp_api_token_instance", "", orgId);
  else if (apiToken) await setTenantSetting(db, "whatsapp_api_token_instance", apiToken, orgId);
  await setTenantSetting(db, "whatsapp_enabled", body.enabled ? "1" : "", orgId);

  const cfg = await whatsappConfig(db, orgId);
  const { whatsapp_webhook_token: token } = await getTenantSettings(db, ["whatsapp_webhook_token"], orgId);
  const effectiveToken = token || await ensureWebhookToken(db, orgId);
  return Response.json({
    ok: true,
    settings: {
      idInstance: cfg.idInstance,
      apiTokenSet: Boolean(cfg.apiToken),
      enabled: cfg.enabled,
      connected: whatsappConfigured(cfg),
      webhookUrl: webhookUrl(request, orgId, effectiveToken),
    },
  }, { headers: { "cache-control": "no-store" } });
}
