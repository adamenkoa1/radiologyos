// Журнал дій (аудит): читання для адміністратора. Скоуп — організація сесії.
// Фільтри: action (код події), actor (частина email), keyset-пагінація beforeId.

import { requireOrgContext } from "../../../../lib/tenant";
import { AUDIT_LABELS, listAuditEvents } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.role !== "admin") return Response.json({ error: "Журнал дій доступний лише адміністратору" }, { status: 403 });

  const url = new URL(request.url);
  const events = await listAuditEvents(db, ctx.organizationId, {
    action: url.searchParams.get("action") || undefined,
    actor: url.searchParams.get("actor") || undefined,
    beforeId: Number(url.searchParams.get("beforeId")) || undefined,
    limit: Number(url.searchParams.get("limit")) || 50,
  });
  return Response.json(
    { events, labels: AUDIT_LABELS, staff: ctx.member },
    { headers: { "cache-control": "no-store" } },
  );
}
