// Best-effort WhatsApp through green-api.com. Configuration is organization-
// scoped. The optional organization id is explicit at tenant-aware call sites;
// omitted means the legacy public org1 path only.

import { getOrganizationIntegrationSettings } from "./settings";

export { interpretBotCommand, menuText, parseIncomingWebhook } from "./whatsapp-bot";
export type { BotAction, IncomingMessage } from "./whatsapp-bot";

const GREEN_API_HOST = "https://api.green-api.com";
const LEGACY_PUBLIC_ORGANIZATION_ID = 1;

export type WhatsAppConfig = { idInstance: string; apiToken: string; enabled: boolean };

export async function whatsappConfig(
  db: D1Database,
  organizationId = LEGACY_PUBLIC_ORGANIZATION_ID,
): Promise<WhatsAppConfig> {
  const s = await getOrganizationIntegrationSettings(db, organizationId, [
    "whatsapp_id_instance", "whatsapp_api_token_instance", "whatsapp_enabled",
  ]);
  const enabled = ["1", "true", "on", "yes"].includes((s.whatsapp_enabled || "").trim().toLowerCase());
  return { idInstance: s.whatsapp_id_instance || "", apiToken: s.whatsapp_api_token_instance || "", enabled };
}

export function whatsappConfigured(cfg: WhatsAppConfig): boolean {
  return Boolean(cfg.idInstance && cfg.apiToken);
}

export async function sendWhatsApp(
  db: D1Database,
  phoneNormalized: string,
  text: string,
  organizationId = LEGACY_PUBLIC_ORGANIZATION_ID,
): Promise<{ ok: boolean; error?: string; idMessage?: string }> {
  const cfg = await whatsappConfig(db, organizationId);
  if (!whatsappConfigured(cfg) || !cfg.enabled) {
    return { ok: false, error: "WhatsApp не підключено для цієї організації" };
  }
  const phone = String(phoneNormalized || "").replace(/\D/g, "");
  if (!phone) return { ok: false, error: "Некоректний номер отримувача" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `${GREEN_API_HOST}/waInstance${encodeURIComponent(cfg.idInstance)}/sendMessage/${encodeURIComponent(cfg.apiToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: `${phone}@c.us`, message: text }),
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (response.ok) {
      const data = await response.json().catch(() => ({})) as { idMessage?: string };
      return { ok: true, idMessage: data.idMessage };
    }
    const data = await response.json().catch(() => ({})) as { message?: string };
    return { ok: false, error: data.message || `green-api відповів помилкою (${response.status})` };
  } catch {
    return { ok: false, error: "Не вдалося з'єднатися з green-api" };
  }
}
