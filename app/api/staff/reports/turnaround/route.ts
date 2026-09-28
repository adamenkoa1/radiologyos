// Звіт TAT (turnaround time): час від виконання дослідження до готового,
// підписаного й виданого протоколу. Агрегат без клінічного тексту — доступний
// адміністратору й завідувачу відділення. Рахується з наявних дат (performed_at,
// protocol_ready_at, protocol_issued_at, protocols.signed_at), а не з ручних полів.

import { requireManagementOrgContext } from "../../../../../lib/tenant";
import { dbBinding } from "../../../../../lib/db";
import { audit } from "../../../../../lib/audit";
import { computeTurnaround, type TatInput } from "../../../../../lib/turnaround";

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

  const rowsRes = await db.prepare(
    `SELECT b.equipment_id AS equipmentId, b.assigned_radiologist_email AS radiologistEmail,
            b.performed_at AS performedAt, b.protocol_ready_at AS readyAt, b.protocol_issued_at AS issuedAt,
            p.signed_at AS signedAt, p.signed_by AS signedBy
       FROM bookings b
       LEFT JOIN protocols p ON p.booking_id = b.id AND p.organization_id = b.organization_id
      WHERE b.organization_id = ? AND b.performed_at != '' AND substr(b.performed_at,1,10) BETWEEN ? AND ?`
  ).bind(orgId, from, to).all<Record<string, unknown>>();

  const rows: TatInput[] = (rowsRes.results || []).map((r) => ({
    equipmentId: String(r.equipmentId || ""),
    radiologistEmail: String(r.radiologistEmail || ""),
    signedBy: String(r.signedBy || ""),
    performedAt: String(r.performedAt || ""),
    readyAt: String(r.readyAt || ""),
    signedAt: String(r.signedAt || ""),
    issuedAt: String(r.issuedAt || ""),
  }));

  const report = computeTurnaround(rows);

  await audit(db, {
    organizationId: orgId,
    actorEmail: ctx.member.email,
    action: "turnaround_report_viewed",
    resource: "report",
    details: { from, to },
  });

  return Response.json({ from, to, report, staff: ctx.member }, { headers: { "cache-control": "no-store" } });
}
