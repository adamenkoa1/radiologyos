// Тестове WhatsApp-повідомлення (кнопка «Надіслати тест») — лише адміністратор.
import { requireStaff } from "../../../../../lib/staff-auth";
import { normalizeUkrainianPhone } from "../../../../../lib/phone";
import { sendWhatsApp } from "../../../../../lib/whatsapp";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member || member.role !== "admin") return Response.json({ error: "Лише адміністратор" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { phone?: string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  if (!phone) return Response.json({ error: "Вкажіть коректний номер для тесту" }, { status: 400 });
  const result = await sendWhatsApp(db, phone, "Тестове повідомлення від відділення променевої діагностики. WhatsApp підключено ✅");
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося надіслати" }, { status: 400 });
  return Response.json({ ok: true });
}
