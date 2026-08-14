// Резолвер провайдерів — добирає реалізації інтеграцій у tenant-контексті.
//
// Messaging configuration is still legacy-global in app_settings. The external
// calendar URL is also legacy-global and belongs to the primary/public tenant,
// so secondary tenants must not receive it until calendar storage is tenantized.
// PACS та payment вже мають per-org джерела.

import { getSettings } from "../settings";
import { getOrgProfile } from "../org-profile";
import type { OrgContext } from "../tenant";
import { createMessagingProvider } from "./messaging";
import { createCalendarProvider } from "./calendar";
import { createPaymentProvider, type PaymentConfig } from "./payment";
import type { PacsProvider, ResolvedProviders } from "./types";

const PRIMARY_ORGANIZATION_ID = 1;

// Дістає конфіг оплат із settings_json профілю організації (безпечно).
function paymentConfig(settings: Record<string, unknown>): PaymentConfig {
  const raw = settings.payment;
  if (!raw || typeof raw !== "object") return {};
  const p = raw as Record<string, unknown>;
  return {
    provider: typeof p.provider === "string" ? p.provider : undefined,
    currency: typeof p.currency === "string" ? p.currency : undefined,
    liqpayPublicKey: typeof p.liqpayPublicKey === "string" ? p.liqpayPublicKey : undefined,
  };
}

export async function resolveProviders(db: D1Database, ctx: OrgContext): Promise<ResolvedProviders> {
  const calendarUrl = ctx.organizationId === PRIMARY_ORGANIZATION_ID
    ? getSettings(db, ["external_ics_url"]).then((s) => s.external_ics_url || "").catch(() => "")
    : Promise.resolve("");

  const [cfg, profile, pacsRow, icsUrl] = await Promise.all([
    getSettings(db, [
      "sms_gateway_url", "sms_gateway_auth",
      "email_gateway_url", "email_gateway_auth", "email_gateway_from",
    ]),
    getOrgProfile(db, ctx),
    db.prepare(
      "SELECT enabled, viewer_base_url AS viewer, dicomweb_base_url AS dicomweb FROM pacs_settings WHERE organization_id = ? LIMIT 1"
    ).bind(ctx.organizationId).first<{ enabled: number; viewer: string; dicomweb: string }>().catch(() => null),
    calendarUrl,
  ]);

  const messaging = createMessagingProvider({
    sms: { url: cfg.sms_gateway_url || "", auth: cfg.sms_gateway_auth || "" },
    email: { url: cfg.email_gateway_url || "", auth: cfg.email_gateway_auth || "", from: cfg.email_gateway_from || "" },
  });

  // PACS доступний, коли його увімкнено в налаштуваннях саме цього tenant.
  const pacsEnabled = Boolean(pacsRow?.enabled);
  const pacs: PacsProvider = {
    name: pacsEnabled ? "dicomweb" : "none",
    enabled: pacsEnabled,
    describe: () => ({
      enabled: pacsEnabled,
      viewerConfigured: Boolean(pacsRow?.viewer),
      dicomwebConfigured: Boolean(pacsRow?.dicomweb),
    }),
  };

  const calendar = createCalendarProvider(icsUrl);

  // Платіжний провайдер добирається з профілю організації (per-org).
  const payment = createPaymentProvider(paymentConfig(profile.settings));

  return { messaging, payment, pacs, calendar };
}
