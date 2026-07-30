// Провайдер-адаптери — єдині інтерфейси зовнішніх інтеграцій.
//
// Мета: абстрагувати месенджинг, платежі, PACS і календар так, щоб під різні
// профілі/організації можна було підмінювати реалізації, не змінюючи бізнес-код.
// Реалізації добираються резолвером (lib/providers/index.ts) у tenant-контексті.

export interface MessagingProvider {
  readonly name: string;
  readonly capabilities: { sms: boolean; email: boolean };
  sendSms(to: string, text: string): Promise<void>;
  sendEmail(to: string, subject: string, text: string): Promise<void>;
}

export interface PaymentProvider {
  readonly name: string;
  readonly configured: boolean;
  // Контракт для майбутніх реалізацій (LiqPay/Приват24 тощо).
  createCharge(input: { amount: number; currency: string; reference: string }): Promise<{ id: string; url?: string }>;
}

export interface PacsProvider {
  readonly name: string;
  readonly enabled: boolean;
  describe(): { enabled: boolean; viewerConfigured: boolean; dicomwebConfigured: boolean };
}

export interface CalendarProvider {
  readonly name: string;
  readonly configured: boolean;
}

export interface ResolvedProviders {
  messaging: MessagingProvider;
  payment: PaymentProvider;
  pacs: PacsProvider;
  calendar: CalendarProvider;
}

// Помилка «канал не налаштовано» — відрізняється від помилки доставлення.
export class ProviderNotConfiguredError extends Error {
  constructor(channel: string) {
    super(`Канал ${channel} не налаштовано`);
    this.name = "ProviderNotConfiguredError";
  }
}
