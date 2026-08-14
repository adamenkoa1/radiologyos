// Резолвер інтеграцій у tenant-контексті.

import { getTenantSettings } from "../tenant-settings";
import { getOrgProfile } from "../org-profile";
import type { OrgContext } from "../tenant";
import { createMessagingProvider } from "./messaging";
import { createCalendarProvider } from "./calendar";
import { createPaymentProvider, type PaymentConfig } from "./payment";
import type { PacsProvider, ResolvedProviders } from "./types";

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
  const orgId = ctx.organizationId;
  const [cfg, profile, pacsRow] = await Promise.all([
    getTenantSettings(db, [
      "sms_gateway_url", "sms_gateway_auth",
      "email_gateway_url", "email_gateway_auth", "email_gateway_from",
      "external_ics_url",
    ], orgId),
    getOrgProfile(db, ctx),
    db.prepare(
      `SELECT enabled, viewer_base_url AS viewer, dicomweb_base_url AS dicomweb
       FROM pacs_settings WHERE organization_id = ? LIMIT 1`
    ).bind(orgId).first<{ enabled: number; viewer: string; dicomweb: string }>().catch(() => null),
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

  const calendar = createCalendarProvider(cfg.external_ics_url || "");
  const payment = createPaymentProvider(paymentConfig(profile.settings));
  return { messaging, payment, pacs, calendar };
}
