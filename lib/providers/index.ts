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
import type {
  PacsProvider, PaymentProvider, ResolvedProviders,
} from "./types";

const nullPayment: PaymentProvider = {
  name: "none",
  configured: false,
  async createCharge() { throw new Error("Платіжний провайдер не налаштовано"); },
};

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

  // PACS доступний лише коли профіль вмикає dicom_pacs і PACS увімкнено в
  // налаштуваннях — інтеграція під контролем feature flag.
  const pacsEnabled = Boolean(profile.flags.dicom_pacs) && Boolean(pacsRow?.enabled);
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

  return { messaging, payment: nullPayment, pacs, calendar };
}
