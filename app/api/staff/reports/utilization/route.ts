// Звіт завантаженості обладнання: потужність за графіком vs фактично виконано
// та заброньовано, простій. Агрегат без даних пацієнтів — доступний
// адміністратору й завідувачу відділення (management-контекст).

import { requireManagementOrgContext } from "../../../../../lib/tenant";
import { getOrganizationSchedule } from "../../../../../lib/tenant-schedule";
import { EQUIP_KEYS, EQUIP_LABELS, hoursFor, isEquipmentDayOpen } from "../../../../../lib/schedule";
import {
  datesInRange, dailyCapacityMinutes, summarizeUtilization, utilizationRow,
} from "../../../../../lib/equipment-utilization";
import { dbBinding } from "../../../../../lib/db";
import { audit } from "../../../../../lib/audit";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireManagementOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Звіт доступний адміністратору або завідувачу відділення" }, { status: 403 });
  const orgId = ctx.organizationId;

  const url = new URL(request.url);
  const def = defaultRange();
  const from = DATE_RE.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : def.from;
  const to = DATE_RE.test(url.searchParams.get("to") || "") ? url.searchParams.get("to")! : def.to;
  if (from > to) return Response.json({ error: "Початок періоду пізніше за кінець" }, { status: 400 });

  const schedule = await getOrganizationSchedule(db, orgId);
  const dates = datesInRange(from, to);

  const [performed, booked] = await Promise.all([
    db.prepare(
      `SELECT equipment_id AS equipmentId, COALESCE(SUM(duration_minutes),0) AS minutes, COUNT(*) AS n
       FROM bookings
       WHERE organization_id = ? AND performed_at != '' AND substr(performed_at,1,10) BETWEEN ? AND ?
       GROUP BY equipment_id`
    ).bind(orgId, from, to).all<{ equipmentId: string; minutes: number; n: number }>(),
    db.prepare(
      `SELECT equipment_id AS equipmentId, COALESCE(SUM(duration_minutes),0) AS minutes
       FROM bookings
       WHERE organization_id = ? AND desired_date BETWEEN ? AND ? AND status != 'cancelled'
       GROUP BY equipment_id`
    ).bind(orgId, from, to).all<{ equipmentId: string; minutes: number }>(),
  ]);

  const performedBy = new Map((performed.results || []).map((r) => [r.equipmentId, r]));
  const bookedBy = new Map((booked.results || []).map((r) => [r.equipmentId, Number(r.minutes)]));

  const rows = EQUIP_KEYS.map((equip) => {
    const hours = hoursFor(schedule, equip);
    const workingDays = dates.filter((d) => isEquipmentDayOpen(d, schedule, equip)).length;
    const perf = performedBy.get(equip);
    return utilizationRow({
      equipmentId: equip,
      label: EQUIP_LABELS[equip] || equip,
      workingDays,
      dailyCapacityMinutes: dailyCapacityMinutes(hours),
      performedMinutes: Number(perf?.minutes || 0),
      performedCount: Number(perf?.n || 0),
      bookedMinutes: bookedBy.get(equip) || 0,
    });
  });
  const totals = summarizeUtilization(rows);

  await audit(db, {
    organizationId: orgId,
    actorEmail: ctx.member.email,
    action: "equipment_utilization_viewed",
    resource: "report",
    details: { from, to },
  });

  return Response.json({ from, to, rows, totals, staff: ctx.member }, { headers: { "cache-control": "no-store" } });
}
