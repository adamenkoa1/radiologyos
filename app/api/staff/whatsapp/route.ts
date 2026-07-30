// Підключення WhatsApp (green-api) — лише адміністратор. Зберігає idInstance,
// apiToken (секрет) і прапорець enabled у app_settings; видає токен вебхука
// й готову URL, яку треба вписати в green-api.

import { requireStaff } from "../../../../lib/staff-auth";
import { getSetting, getSettings, setSetting } from "../../../../lib/settings";
import { whatsappConfig, whatsappConfigured } from "../../../../lib/whatsapp";
import { dbBinding } from "../../../../lib/db";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function ensureWebhookToken(db: D1Database): Promise<string> {
  const existing = await getSetting(db, "whatsapp_webhook_token");
  if (existing) return existing;
  const token = crypto.randomUUID().replace(/-/g, "");
  await setSetting(db, "whatsapp_webhook_token", token);
  return token;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "WhatsApp налаштовує лише адміністратор" }, { status: 403 });

  const cfg = await whatsappConfig(db);
  const token = await ensureWebhookToken(db);
  const origin = new URL(request.url).origin;
  return Response.json({
    settings: {
      idInstance: cfg.idInstance,
      apiTokenSet: Boolean(cfg.apiToken),
      enabled: cfg.enabled,
      connected: whatsappConfigured(cfg),
      webhookUrl: `${origin}/api/whatsapp/webhook?token=${token}`,
    },
    staff: member,
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Змінювати WhatsApp може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { idInstance?: string; apiToken?: string; enabled?: boolean };
  const idInstance = clean(body.idInstance, 40);
  const apiToken = clean(body.apiToken, 200);
  // Порожнє поле лишає збережене; "-" очищає (як з іншими секретами).
  if (idInstance === "-") await setSetting(db, "whatsapp_id_instance", "");
  else if (idInstance) await setSetting(db, "whatsapp_id_instance", idInstance);
  if (apiToken === "-") await setSetting(db, "whatsapp_api_token_instance", "");
  else if (apiToken) await setSetting(db, "whatsapp_api_token_instance", apiToken);
  await setSetting(db, "whatsapp_enabled", body.enabled ? "1" : "");

  const cfg = await whatsappConfig(db);
  const { whatsapp_webhook_token: token } = await getSettings(db, ["whatsapp_webhook_token"]);
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
