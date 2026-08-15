import { todayInKyiv } from "../../../../../lib/booking-rules";
import { logSecurityEvent } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { canViewManagementSummary } from "../../../../../lib/staff-auth";
import { requireManagementOrgContext } from "../../../../../lib/tenant";
import { stateLabel } from "../../../../../lib/study-state";

const CLINICAL_QUEUE_STATES = ["queued", "in_progress", "images_ready", "reporting", "protocol_ready"] as const;

const num = (row: Record<string, unknown> | null, key = "c") => Number(row?.[key] || 0);

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });

  const ctx = await requireManagementOrgContext(request, db);
  if (!ctx || !canViewManagementSummary(ctx.role)) {
    return Response.json({ error: "Управлінське зведення доступне лише завідувачу відділення" }, { status: 403 });
  }

  const orgId = ctx.organizationId;
  const today = todayInKyiv();
  const weekStart = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const one = (sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).first<Record<string, unknown>>();
  const many = (sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).all();

  const [
    scheduledToday,
    performedToday,
    awaitingProtocol,
    readyToIssue,
    needImaging,
    clinicalQueueRows,
    equipmentTodayRows,
    maintenance,
    staffByRoleRows,
    volume7dRows,
  ] = await Promise.all([
    one(
      "SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND desired_date = ? AND status != 'cancelled'",
      orgId, today,
    ),
    one(
      "SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND substr(performed_at,1,10) = ? AND status != 'cancelled'",
      orgId, today,
    ),
    one(
      "SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND performed_at != '' AND protocol_status NOT IN ('ready','issued') AND status != 'cancelled'",
      orgId,
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
    many(
      `SELECT status AS state, COUNT(*) AS count FROM bookings
       WHERE organization_id = ? AND status IN ('queued','in_progress','images_ready','reporting','protocol_ready')
       GROUP BY status`,
      orgId,
    ),
    many(
      `SELECT equipment_id AS equipmentId, COUNT(*) AS scheduled
       FROM bookings
       WHERE organization_id = ? AND desired_date = ? AND status != 'cancelled'
       GROUP BY equipment_id ORDER BY equipment_id`,
      orgId, today,
    ),
    one(
      `SELECT
         SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS activeMaintenance,
         SUM(CASE WHEN event_type = 'fault' AND status IN ('open','in_progress') THEN 1 ELSE 0 END) AS openFaults,
         SUM(CASE WHEN downtime_start != '' AND downtime_end = '' AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS activeDowntime
       FROM equipment_maintenance WHERE organization_id = ?`,
      orgId,
    ),
    many(
      `SELECT m.role AS role, COUNT(*) AS count
       FROM memberships m
       JOIN staff_members s ON s.email = m.member_email AND s.active = 1
       WHERE m.organization_id = ? AND m.active = 1
       GROUP BY m.role ORDER BY m.role`,
      orgId,
    ),
    many(
      `SELECT desired_date AS date, COUNT(*) AS count
       FROM bookings
       WHERE organization_id = ? AND desired_date BETWEEN ? AND ? AND status != 'cancelled'
       GROUP BY desired_date ORDER BY desired_date`,
      orgId, weekStart, today,
    ),
  ]);

  const queueCounts = new Map(
    ((clinicalQueueRows as { results?: Array<Record<string, unknown>> }).results || [])
      .map((row) => [String(row.state), Number(row.count || 0)] as const),
  );

  await logSecurityEvent(db, {
    organizationId: orgId,
    actorEmail: ctx.member.email,
    action: "management_summary_viewed",
    resource: "management_summary",
    targetId: String(orgId),
    details: { date: today },
  });

  return Response.json({
    organization: {
      id: orgId,
      slug: ctx.slug,
      name: ctx.organizationName,
    },
    today,
    weekStart,
    summary: {
      scheduledToday: num(scheduledToday),
      performedToday: num(performedToday),
      awaitingProtocol: num(awaitingProtocol),
      readyToIssue: num(readyToIssue),
      needImaging: num(needImaging),
      activeMaintenance: num(maintenance, "activeMaintenance"),
      openFaults: num(maintenance, "openFaults"),
      activeDowntime: num(maintenance, "activeDowntime"),
    },
    clinicalQueue: CLINICAL_QUEUE_STATES.map((state) => ({
      state,
      label: stateLabel(state),
      count: queueCounts.get(state) || 0,
    })),
    equipmentToday: (equipmentTodayRows as { results?: Array<Record<string, unknown>> }).results || [],
    staffByRole: (staffByRoleRows as { results?: Array<Record<string, unknown>> }).results || [],
    volume7d: (volume7dRows as { results?: Array<Record<string, unknown>> }).results || [],
    staff: ctx.member,
  }, { headers: { "cache-control": "no-store" } });
}
