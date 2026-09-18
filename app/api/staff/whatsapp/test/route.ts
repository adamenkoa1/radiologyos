// Тестове WhatsApp-повідомлення (кнопка «Надіслати тест») через
// integration settings поточної організації.

import { canManageSystem } from "../../../../../lib/staff-auth";
import { requireSystemOrgContext } from "../../../../../lib/tenant";
import { normalizeUkrainianPhone } from "../../../../../lib/phone";
import { sendWhatsApp } from "../../../../../lib/whatsapp";
import { dbBinding } from "../../../../../lib/db";
import { audit } from "../../../../../lib/audit";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx || !canManageSystem(ctx.role)) {
    return Response.json({ error: "Лише системний адміністратор організації" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as { phone?: string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  if (!phone) return Response.json({ error: "Вкажіть коректний номер для тесту" }, { status: 400 });
  const result = await sendWhatsApp(
    db,
    phone,
    "Тестове повідомлення від відділення променевої діагностики. WhatsApp підключено ✅",
    ctx.organizationId,
  );
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося надіслати" }, { status: 400 });
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "whatsapp_integration_test",
    resource: "settings",
    details: { scope: "organization_integrations" },
  });
  return Response.json({ ok: true });
}
