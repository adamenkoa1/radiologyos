// Резолвер провайдерів — добирає реалізації інтеграцій у tenant-контексті.
//
// Наразі конфігурація інтеграцій зберігається глобально (app_settings /
// pacs_settings), але резолвер — це єдиний шов, куди згодом зайде per-org
// конфігурація. Профіль організації (feature flags) вже впливає на доступність
// (напр. PACS вимкнено прапорцем dicom_pacs → provider.enabled = false).

import { getSettings } from "../settings";
import { getOrgProfile } from "../org-profile";
import type { OrgContext } from "../tenant";
import { createMessagingProvider } from "./messaging";
import { createCalendarProvider } from "./calendar";
import { createPaymentProvider, type PaymentConfig } from "./payment";
import type { PacsProvider, ResolvedProviders } from "./types";

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
  const [cfg, profile, pacsRow, icsUrl] = await Promise.all([
    getSettings(db, [
      "sms_gateway_url", "sms_gateway_auth",
      "email_gateway_url", "email_gateway_auth", "email_gateway_from",
    ]),
    getOrgProfile(db, ctx),
    db.prepare("SELECT enabled, viewer_base_url AS viewer, dicomweb_base_url AS dicomweb FROM pacs_settings WHERE id = 1")
      .first<{ enabled: number; viewer: string; dicomweb: string }>().catch(() => null),
    getSettings(db, ["external_ics_url"]).then((s) => s.external_ics_url || "").catch(() => ""),
  ]);

  const messaging = createMessagingProvider({
    sms: { url: cfg.sms_gateway_url || "", auth: cfg.sms_gateway_auth || "" },
    email: { url: cfg.email_gateway_url || "", auth: cfg.email_gateway_auth || "", from: cfg.email_gateway_from || "" },
  });

  // PACS доступний, коли його увімкнено в налаштуваннях PACS.
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
