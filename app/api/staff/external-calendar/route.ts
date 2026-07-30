// Найближчі події зовнішнього календаря організації для дашборду персоналу.
// Доставку абстраговано календар-провайдером (lib/providers/calendar); джерело
// (external_ics_url) добирається резолвером у tenant-контексті. Staff-only.

import { canAccessAllBookings } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { resolveProviders } from "../../../../lib/providers";
import { dbBinding } from "../../../../lib/db";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canAccessAllBookings(ctx.member.role)) {
    return Response.json({ error: "Календар доступний лише реєстратору або адміністратору" }, { status: 403 });
  }

  const { calendar } = await resolveProviders(db, ctx);
  const result = await calendar.listUpcoming();
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
