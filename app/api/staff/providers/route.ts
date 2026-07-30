import { requireOrgContext } from "../../../../lib/tenant";
import { resolveProviders } from "../../../../lib/providers";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

// Стан провайдер-адаптерів організації (діагностика). organizationId — лише зі
// серверної сесії; перегляд для адміністратора.
export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.role !== "admin") {
    return Response.json({ error: "Стан інтеграцій доступний лише адміністратору" }, { status: 403 });
  }

  const providers = await resolveProviders(db, ctx);
  return Response.json({
    organization: { id: ctx.organizationId, name: ctx.organizationName },
    providers: {
      messaging: { name: providers.messaging.name, ...providers.messaging.capabilities },
      payment: { name: providers.payment.name, configured: providers.payment.configured },
      pacs: { name: providers.pacs.name, ...providers.pacs.describe() },
      calendar: { name: providers.calendar.name, configured: providers.calendar.configured },
    },
  });
}
