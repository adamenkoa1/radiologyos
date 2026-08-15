// Прив'язка Telegram пацієнта: короткоживучі токени для deep-link «Старт»
// і обробник вхідних оновлень від бота (webhook). Пацієнт натискає «Старт»
// у боті один раз — ми зіставляємо токен із tenant + телефоном + доведеною
// ідентичністю та, коли вона відома, immutable patient_id.

import { hashToken, newSessionToken } from "./auth";
import type { PatientIdentityScope } from "./patient-auth";

export const TELEGRAM_LINK_TTL_SECONDS = 15 * 60;
const PRIMARY_ORGANIZATION_ID = 1;
const STALE_LINK_REPLY = "Посилання застаріло. Відкрийте кабінет і натисніть «Підключити Telegram» ще раз.";

export async function createTelegramLinkToken(
  db: D1Database,
  phoneNormalized: string,
  organizationId: number,
  identity: PatientIdentityScope,
  patientId = "",
): Promise<string> {
  const rawToken = newSessionToken();
  const tokenHash = await hashToken(rawToken);
  await db.prepare(
    `INSERT INTO telegram_link_tokens
      (token_hash, organization_id, phone_normalized, identity_kind, identity_value, patient_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`
  ).bind(
    tokenHash,
    organizationId,
    phoneNormalized,
    identity.kind,
    identity.value,
    patientId,
    `+${TELEGRAM_LINK_TTL_SECONDS} seconds`,
  ).run();
  await db.prepare("DELETE FROM telegram_link_tokens WHERE expires_at <= CURRENT_TIMESTAMP").run();
  return rawToken;
}

export async function consumeTelegramLinkToken(
  db: D1Database,
  rawToken: string,
): Promise<{ organizationId: number; phone: string; identity: PatientIdentityScope; patientId: string } | null> {
  const token = String(rawToken || "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  const row = await db.prepare(
    `SELECT organization_id AS organizationId, phone_normalized AS phone,
       identity_kind AS identityKind, identity_value AS identityValue, patient_id AS patientId
     FROM telegram_link_tokens
     WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP
       AND identity_kind IN ('dob','booking') AND identity_value != ''
     LIMIT 1`
  ).bind(tokenHash).first<{
    organizationId: number;
    phone: string;
    identityKind: "dob" | "booking";
    identityValue: string;
    patientId: string;
  }>().catch(() => null);
  await db.prepare("DELETE FROM telegram_link_tokens WHERE token_hash = ?").bind(tokenHash).run();
  return row ? {
    organizationId: row.organizationId,
    phone: row.phone,
    identity: { kind:row.identityKind, value:row.identityValue },
    patientId: row.patientId || "",
  } : null;
}

export async function linkPatientTelegram(
  db: D1Database,
  organizationId: number,
  phoneNormalized: string,
  identity: PatientIdentityScope,
  chatId: string,
  patientId = "",
): Promise<void> {
  await db.prepare(
    `INSERT INTO patient_telegram_identities
      (organization_id, phone_normalized, identity_kind, identity_value, patient_id, telegram_chat_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id, phone_normalized, identity_kind, identity_value) DO UPDATE SET
       telegram_chat_id = excluded.telegram_chat_id,
       patient_id = excluded.patient_id,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(organizationId, phoneNormalized, identity.kind, identity.value, patientId, chatId).run();
}

// /stop is bot-wide consent revocation for this chat. If the same human linked
// the same bot for more than one identity/tenant, remove every matching link.
export async function unlinkPatientTelegram(db: D1Database, chatId: string): Promise<void> {
  await db.prepare(
    "UPDATE patient_telegram_identities SET telegram_chat_id = '', updated_at = CURRENT_TIMESTAMP WHERE telegram_chat_id = ?"
  ).bind(chatId).run();
  // Keep legacy phone-wide storage inert if a pre-0046 database is encountered
  // during a rolling upgrade.
  await db.prepare(
    "UPDATE patient_profiles SET telegram_chat_id = '', updated_at = CURRENT_TIMESTAMP WHERE telegram_chat_id = ?"
  ).bind(chatId).run().catch(() => undefined);
}

interface TelegramUpdate {
  message?: { chat?: { id?: number | string }; text?: string };
}

export async function handleTelegramUpdate(db: D1Database, update: TelegramUpdate): Promise<{ chatId: string; reply: string }> {
  const chatId = update?.message?.chat?.id != null ? String(update.message.chat.id) : "";
  const text = (update?.message?.text || "").trim();
  if (!chatId || !text) return { chatId: "", reply: "" };

  if (/^\/stop\b/.test(text)) {
    await unlinkPatientTelegram(db, chatId);
    return { chatId, reply: "Ви відписались від сповіщень. Щоб знову підключити — натисніть кнопку в кабінеті." };
  }

  const m = text.match(/^\/start\s+([a-f0-9]{64})$/);
  if (!m) {
    return { chatId, reply: "Щоб підключити сповіщення, відкрийте кабінет на сайті й натисніть «Підключити Telegram»." };
  }
  const target = await consumeTelegramLinkToken(db, m[1]);
  // This webhook belongs to the legacy-global bot of the primary organization.
  // Consume any foreign token once, but never bind that tenant to the org1 bot.
  if (!target || target.organizationId !== PRIMARY_ORGANIZATION_ID) {
    return { chatId, reply: STALE_LINK_REPLY };
  }
  await linkPatientTelegram(
    db,
    target.organizationId,
    target.phone,
    target.identity,
    chatId,
    target.patientId,
  );
  return { chatId, reply: "✅ Готово! Сповіщення про ваші дослідження надходитимуть у цей чат." };
}
