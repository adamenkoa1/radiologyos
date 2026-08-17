// Sends a test message to the current organization's Telegram chat using its
// organization-scoped integration settings. Authorization follows the same
// system control plane as the settings endpoint.

import { canManageSystem } from "../../../../../lib/staff-auth";
import { requireSystemOrgContext } from "../../../../../lib/tenant";
import { sendTelegramResult } from "../../../../../lib/telegram";
import { dbBinding } from "../../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageSystem(ctx.role)) {
    return Response.json({ error: "Доступно лише системному адміністратору організації" }, { status: 403 });
  }

  const text = "✅ <b>RadiologyOS</b>\nТестове повідомлення. Сповіщення про заявки налаштовано правильно.";
  const result = await sendTelegramResult(db, text, ctx.organizationId);
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося надіслати" }, { status: 400 });
  return Response.json({ ok: true });
}
