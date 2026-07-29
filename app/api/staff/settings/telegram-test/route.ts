// Sends a test message to the department Telegram chat using the saved
// settings, so an admin can verify the bot token and chat id in one click.

import { requireStaff } from "../../../../../lib/staff-auth";
import { sendTelegramResult } from "../../../../../lib/telegram";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Доступно лише адміністратору" }, { status: 403 });

  const text = "✅ <b>RadiologyOS</b>\nТестове повідомлення. Сповіщення про заявки налаштовано правильно.";
  const result = await sendTelegramResult(db, text, member.organizationId);
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося надіслати" }, { status: 400 });
  return Response.json({ ok: true });
}
