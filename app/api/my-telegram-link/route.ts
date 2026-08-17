// Видає пацієнту (за активною сесією кабінету) deep-link для під'єднання
// Telegram-бота. Bot username/token are loaded only from the session tenant.

import {
  patientSessionScopeIsUnambiguous,
  requirePatientSession,
  type PatientIdentityScope,
} from "../../../lib/patient-auth";
import { createTelegramLinkToken } from "../../../lib/telegram-link";
import { telegramBotUsername } from "../../../lib/telegram";
import { isRateLimited } from "../../../lib/rate-limit";
import { dbBinding } from "../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  const session = await requirePatientSession(request, db);
  if (!session) return Response.json({ error: "Сесію не підтверджено" }, { status: 401 });
  if (!await patientSessionScopeIsUnambiguous(db, session)) {
    return Response.json(
      { error: "За цим номером і датою народження знайдено кілька записів. Увійдіть за кодом конкретної заявки." },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
  if (await isRateLimited(db, request, "telegram-link", 6, 15)) {
    return Response.json({ error: "Забагато спроб. Спробуйте трохи пізніше." }, { status: 429 });
  }

  const username = await telegramBotUsername(db, session.organizationId);
  if (!username) {
    return Response.json({ error: "Telegram-канал ще не налаштований відділенням", botConfigured: false }, { status: 503 });
  }

  let telegramIdentity: PatientIdentityScope = { kind:session.identityKind, value:session.identityValue };
  if (session.identityKind === "dob") {
    const exactClause = session.patientId ? "AND patient_id = ?" : "";
    const bindings = session.patientId
      ? [session.organizationId, session.phoneNormalized, session.identityValue, session.patientId]
      : [session.organizationId, session.phoneNormalized, session.identityValue];
    const rows = await db.prepare(
      `SELECT code FROM bookings
       WHERE organization_id = ? AND phone_normalized = ? AND date_of_birth = ? ${exactClause}
       ORDER BY id DESC LIMIT 2`,
    ).bind(...bindings).all<{ code:string }>();
    const chosen = session.patientId ? rows.results[0] : rows.results.length === 1 ? rows.results[0] : null;
    if (!chosen?.code) {
      return Response.json(
        { error: "Не вдалося однозначно визначити заявку. Увійдіть за кодом конкретної заявки." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    telegramIdentity = { kind:"booking", value:chosen.code };
  }

  const token = await createTelegramLinkToken(
    db, session.phoneNormalized, session.organizationId, telegramIdentity, session.patientId || "",
  );
  return Response.json({ url:`https://t.me/${username}?start=${token}` }, { headers:{ "cache-control":"no-store" } });
}
