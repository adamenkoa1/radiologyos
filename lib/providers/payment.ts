// Платіжний провайдер — добирається за назвою з конфігурації організації
// (organization_profiles.settings_json → payment). Реалізації:
//  • none   — оплати не приймаються онлайн (за замовчуванням);
//  • manual — ручна звірка (готівка/переказ), без зовнішнього шлюзу;
//  • liqpay — онлайн-шлюз (інтеграція-заглушка: describe/статус готові,
//             createCharge поки кидає «не інтегровано»).
//
// `import type` не залишає рантайм-залежностей — модуль чистий і тестується
// виконанням.

import type { PaymentProvider, PaymentProviderName } from "./types";

export interface PaymentConfig {
  provider?: string;
  currency?: string;
  liqpayPublicKey?: string;
}

const KNOWN: readonly PaymentProviderName[] = ["none", "manual", "liqpay"];

export function isPaymentProviderName(value: string): value is PaymentProviderName {
  return (KNOWN as readonly string[]).includes(value);
}

export function createPaymentProvider(cfg: PaymentConfig = {}): PaymentProvider {
  const name: PaymentProviderName = cfg.provider && isPaymentProviderName(cfg.provider) ? cfg.provider : "none";
  const currency = (cfg.currency || "UAH").toUpperCase().slice(0, 3);

  if (name === "manual") {
    return {
      name: "manual",
      configured: true,
      describe: () => ({ name: "manual", configured: true, currency, capabilities: { onlineCharge: false, manualReconciliation: true } }),
      // Ручна оплата: повертаємо детермінований референс для звірки.
      async createCharge(input) {
        return { id: `manual-${input.reference}` };
      },
    };
  }

  if (name === "liqpay") {
    const configured = Boolean(cfg.liqpayPublicKey);
    return {
      name: "liqpay",
      configured,
      describe: () => ({ name: "liqpay", configured, currency, capabilities: { onlineCharge: true, manualReconciliation: false } }),
      async createCharge() {
        throw new Error("LiqPay ще не інтегровано");
      },
    };
  }

  return {
    name: "none",
    configured: false,
    describe: () => ({ name: "none", configured: false, currency, capabilities: { onlineCharge: false, manualReconciliation: false } }),
    async createCharge() {
      throw new Error("Платіжний провайдер не налаштовано");
    },
  };
}
