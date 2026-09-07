// «Червоні зони» завідувача: операційні метрики зі статусами ok/warn/alert.
// Агрегат без даних пацієнтів — доступ адміністратору й завідувачу відділення.

import { todayInKyiv } from "../../../../../lib/booking-rules";
import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { canViewManagementSummary } from "../../../../../lib/staff-auth";
import { requireManagementOrgContext } from "../../../../../lib/tenant";
import { attentionCount, buildRedZones } from "../../../../../lib/management-kpi";

const num = (row: Record<string, unknown> | null, key = "c") => Number(row?.[key] || 0);

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireManagementOrgContext(request, db);
  if (!ctx || !canViewManagementSummary(ctx.role)) {
    return Response.json({ error: "Пульт завідувача доступний адміністратору або завідувачу відділення" }, { status: 403 });
  }
  const orgId = ctx.organizationId;
  const today = todayInKyiv();
  const one = (sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).first<Record<string, unknown>>();

  const [overdue, ready, needImaging, newBookings, maintenance, receivables] = await Promise.all([
    one(
      `SELECT COUNT(*) AS c FROM bookings
       WHERE organization_id = ? AND performed_at != '' AND substr(performed_at,1,10) < date(?, '-2 days')
         AND protocol_status NOT IN ('ready','issued') AND status != 'cancelled'`,
      orgId, today,
    ),
    one(
      "SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND protocol_status = 'ready' AND status != 'cancelled'",
      orgId,
    ),
    one(
      `SELECT COUNT(*) AS c FROM bookings b
       LEFT JOIN imaging_studies i ON i.booking_id = b.id AND i.organization_id = b.organization_id
       WHERE b.organization_id = ? AND b.performed_at != '' AND b.status != 'cancelled' AND i.booking_id IS NULL`,
      orgId,
    ),
    one(
      "SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND status = 'new'",
      orgId,
    ),
    one(
      `SELECT
         SUM(CASE WHEN event_type = 'fault' AND status IN ('open','in_progress') THEN 1 ELSE 0 END) AS openFaults,
         SUM(CASE WHEN downtime_start != '' AND downtime_end = '' AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS activeDowntime
       FROM equipment_maintenance WHERE organization_id = ?`,
      orgId,
    ),
    one(
      `SELECT COALESCE(SUM(payment_amount - paid_amount),0) AS c FROM bookings
       WHERE organization_id = ? AND status != 'cancelled' AND payment_amount > paid_amount`,
      orgId,
    ),
  ]);

  const cards = buildRedZones({
    overdueProtocols: num(overdue),
    readyToIssue: num(ready),
    needImaging: num(needImaging),
    newBookings: num(newBookings),
    openFaults: num(maintenance, "openFaults"),
    activeDowntime: num(maintenance, "activeDowntime"),
    receivablesDue: num(receivables),
  });

  await audit(db, {
    organizationId: orgId,
    actorEmail: ctx.member.email,
    action: "management_red_zones_viewed",
    resource: "management_summary",
    details: { attention: attentionCount(cards) },
  });

  return Response.json(
    { today, cards, attention: attentionCount(cards), staff: ctx.member },
    { headers: { "cache-control": "no-store" } },
  );
}
