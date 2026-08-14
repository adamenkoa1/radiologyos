// Best-effort WhatsApp через green-api.com. Credentials are tenant-scoped;
// callers without an explicit organization stay on public/legacy organization 1.

import { getTenantSettings } from "./tenant-settings";

export { interpretBotCommand, menuText, parseIncomingWebhook } from "./whatsapp-bot";
export type { BotAction, IncomingMessage } from "./whatsapp-bot";

const GREEN_API_HOST = "https://api.green-api.com";

export type WhatsAppConfig = { idInstance: string; apiToken: string; enabled: boolean };

export async function whatsappConfig(db: D1Database, organizationId = 1): Promise<WhatsAppConfig> {
  const s = await getTenantSettings(
    db,
    ["whatsapp_id_instance", "whatsapp_api_token_instance", "whatsapp_enabled"],
    organizationId,
  );
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
  organizationId = 1,
): Promise<{ ok: boolean; error?: string; idMessage?: string }> {
  const cfg = await whatsappConfig(db, organizationId);
  if (!whatsappConfigured(cfg)) return { ok: false, error: "WhatsApp не підключено (немає idInstance / apiToken)" };
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
