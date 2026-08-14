// Тестове WhatsApp-повідомлення (кнопка «Надіслати тест»).
// WhatsApp config is legacy-global, so only the primary/public organization
// may use the test endpoint until configuration is tenantized.
import { requireOrgContext } from "../../../../../lib/tenant";
import { normalizeUkrainianPhone } from "../../../../../lib/phone";
import { sendWhatsApp } from "../../../../../lib/whatsapp";
import { dbBinding } from "../../../../../lib/db";

const PRIMARY_ORGANIZATION_ID = 1;

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.organizationId !== PRIMARY_ORGANIZATION_ID || ctx.role !== "admin") {
    return Response.json({ error: "Лише адміністратор основної організації" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as { phone?: string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  if (!phone) return Response.json({ error: "Вкажіть коректний номер для тесту" }, { status: 400 });
  const result = await sendWhatsApp(db, phone, "Тестове повідомлення від відділення променевої діагностики. WhatsApp підключено ✅");
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося надіслати" }, { status: 400 });
  return Response.json({ ok: true });
}
