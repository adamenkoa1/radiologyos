// Месенджинг-провайдер: доставлення SMS / e-mail через налаштовувані HTTP-шлюзи.
// Уся зовнішня взаємодія проходить через політику зовнішніх підключень
// (safeOutboundUrl + fetchLimited), як і раніше.

import { fetchLimited, readLimitedText, safeOutboundUrl } from "../outbound";
import { ProviderNotConfiguredError, type MessagingProvider } from "./types";

export interface MessagingConfig {
  sms: { url: string; auth: string };
  email: { url: string; auth: string; from: string };
}

async function postJson(url: string, auth: string, payload: Record<string, string>): Promise<void> {
  const outbound = safeOutboundUrl(url);
  if (!outbound) throw new Error("Адреса шлюзу заборонена політикою зовнішніх підключень");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  const response = await fetchLimited(outbound, { method: "POST", headers, body: JSON.stringify(payload) }, 5000);
  if (!response.ok) {
    const detail = await readLimitedText(response).catch(() => "");
    throw new Error(`Шлюз відповів ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
  }
}

// HTTP-провайдер: шле у налаштовані шлюзи; для ненастроєного каналу кидає
// ProviderNotConfiguredError (щоб викликач міг позначити «пропущено»).
export function createMessagingProvider(cfg: MessagingConfig): MessagingProvider {
  const smsUrl = cfg.sms.url || "";
  const emailUrl = cfg.email.url || "";
  return {
    name: "http-gateway",
    capabilities: { sms: !!smsUrl, email: !!emailUrl },
    async sendSms(to: string, text: string): Promise<void> {
      if (!smsUrl) throw new ProviderNotConfiguredError("SMS");
      await postJson(smsUrl, cfg.sms.auth || "", { to, text });
    },
    async sendEmail(to: string, subject: string, text: string): Promise<void> {
      if (!emailUrl) throw new ProviderNotConfiguredError("email");
      await postJson(emailUrl, cfg.email.auth || "", { to, from: cfg.email.from || "", subject, text });
    },
  };
}
