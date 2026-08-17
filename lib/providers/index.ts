// Резолвер провайдерів — добирає реалізації інтеграцій у tenant-контексті.
// Integration settings are scoped by organization. Organization 1 alone may
// use the legacy app_settings compatibility read; secondary tenants never fall
// back to primary credentials.

import { getOrganizationIntegrationSettings } from "../settings";
import { getOrgProfile } from "../org-profile";
import type { OrgContext } from "../tenant";
import { createMessagingProvider } from "./messaging";
import { createCalendarProvider } from "./calendar";
import { createPaymentProvider, type PaymentConfig } from "./payment";
import type { PacsProvider, ResolvedProviders } from "./types";

const MESSAGING_SETTING_KEYS = [
  "sms_gateway_url", "sms_gateway_auth",
  "email_gateway_url", "email_gateway_auth", "email_gateway_from",
];

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
  const [cfg, profile, pacsRow, calendarCfg] = await Promise.all([
    getOrganizationIntegrationSettings(db, ctx.organizationId, MESSAGING_SETTING_KEYS),
    getOrgProfile(db, ctx),
    db.prepare(
      "SELECT enabled, viewer_base_url AS viewer, dicomweb_base_url AS dicomweb FROM pacs_settings WHERE organization_id = ? LIMIT 1"
    ).bind(ctx.organizationId).first<{ enabled: number; viewer: string; dicomweb: string }>().catch(() => null),
    getOrganizationIntegrationSettings(db, ctx.organizationId, ["external_ics_url"]),
  ]);

  const messaging = createMessagingProvider({
    sms: { url: cfg.sms_gateway_url || "", auth: cfg.sms_gateway_auth || "" },
    email: { url: cfg.email_gateway_url || "", auth: cfg.email_gateway_auth || "", from: cfg.email_gateway_from || "" },
  });

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

  const calendar = createCalendarProvider(calendarCfg.external_ics_url || "");
  const payment = createPaymentProvider(paymentConfig(profile.settings));

  return { messaging, payment, pacs, calendar };
}
