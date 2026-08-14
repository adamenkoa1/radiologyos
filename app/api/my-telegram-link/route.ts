// Видає пацієнту (за активною сесією кабінету) deep-link для під'єднання
// Telegram-бота: t.me/<bot>?start=<token>. Токен прив'язаний до tenant,
// телефону та доведеної ідентичності пацієнта.
// Telegram bot config is still legacy-global and belongs to org 1, so secondary
// tenants must not receive a deep-link until bot configuration is tenantized.

import { requirePatientSession } from "../../../lib/patient-auth";
import { createTelegramLinkToken } from "../../../lib/telegram-link";
import { telegramBotUsername } from "../../../lib/telegram";
import { isRateLimited } from "../../../lib/rate-limit";
import { dbBinding } from "../../../lib/db";

const PRIMARY_ORGANIZATION_ID = 1;

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  const session = await requirePatientSession(request, db);
  if (!session) return Response.json({ error: "Сесію не підтверджено" }, { status: 401 });
  if (session.organizationId !== PRIMARY_ORGANIZATION_ID) {
    return Response.json(
      { error: "Telegram-канал ще не налаштований відділенням", botConfigured: false },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (await isRateLimited(db, request, "telegram-link", 6, 15)) {
    return Response.json({ error: "Забагато спроб. Спробуйте трохи пізніше." }, { status: 429 });
  }

  const username = await telegramBotUsername(db);
  if (!username) {
    return Response.json({ error: "Telegram-канал ще не налаштований відділенням", botConfigured: false }, { status: 503 });
  }
  const token = await createTelegramLinkToken(
    db,
    session.phoneNormalized,
    session.organizationId,
    { kind:session.identityKind, value:session.identityValue },
  );
  const url = `https://t.me/${username}?start=${token}`;
  return Response.json({ url }, { headers: { "cache-control": "no-store" } });
}
