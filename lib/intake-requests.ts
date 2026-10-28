// Вхідні заявки на запис із месенджерів (стартовий канал — Telegram), щоб
// звернення пацієнта не губилося. Це НЕ підтверджене бронювання — реєстратор
// опрацьовує заявку на сайті. Модуль лише фіксує/читає заявки; жодних зовнішніх
// викликів і жодних медичних даних у заявці не зберігаємо понад текст звернення.

export const INTAKE_MESSAGE_MAX = 2000;

// Чесний підтверджувальний текст боту: мінімум даних, без діагнозу/результатів.
export const INTAKE_ACK_REPLY =
  "Дякуємо! Вашу заявку на запис отримано — адміністратор звʼяжеться з вами для підтвердження часу та підготовки. " +
  "Результати досліджень надаються лише через захищений вхід у систему, не в чаті.";

export type IntakeChannel = "telegram" | "phone" | "whatsapp" | "email" | "viber";

export type CaptureIntakeInput = {
  channel: IntakeChannel;
  externalRef: string;      // ідентифікатор діалогу (напр. telegram chat_id)
  externalUpdateId?: string; // для ідемпотентності повторної доставки
  contact: string;          // куди відповідати
  message: string;          // текст звернення пацієнта
};

// Ідемпотентна фіксація заявки: повторна доставка з тим самим update_id не
// створює дубль (атомарний INSERT ... WHERE NOT EXISTS). Повертає true, якщо
// заявку створено новою.
export async function captureIntakeRequest(
  db: D1Database,
  input: CaptureIntakeInput,
  organizationId: number,
): Promise<boolean> {
  if (!Number.isInteger(organizationId) || organizationId <= 0) return false;
  const message = String(input.message || "").trim().slice(0, INTAKE_MESSAGE_MAX);
  if (!message) return false;
  const channel = input.channel;
  const externalRef = String(input.externalRef || "").slice(0, 120);
  const externalUpdateId = String(input.externalUpdateId || "").slice(0, 120);
  const contact = String(input.contact || "").slice(0, 120);
  const result = await db.prepare(
    `INSERT INTO intake_requests (organization_id, channel, external_ref, external_update_id, contact, message)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM intake_requests
       WHERE organization_id = ? AND channel = ? AND external_update_id = ? AND external_update_id != ''
     )`
  ).bind(
    organizationId, channel, externalRef, externalUpdateId, contact, message,
    organizationId, channel, externalUpdateId,
  ).run();
  return Number(result.meta?.changes || 0) > 0;
}
