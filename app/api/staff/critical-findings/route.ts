// Критичні знахідки: позначення ургентної патології, фіксація доведення й
// закриття. Перелік/дії — для клінічного персоналу (містить дані пацієнта);
// агрегат «відкриті» окремо потрапляє в «червоні зони» завідувача.

import { requireOrgContext } from "../../../../lib/tenant";
import { canManageProtocols, canWriteNotes } from "../../../../lib/staff-auth";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";
import { sanitizeNote, sanitizeVia } from "../../../../lib/critical-findings";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canWriteNotes(ctx.member.role)) {
    return Response.json({ error: "Критичні знахідки доступні клінічному персоналу" }, { status: 403 });
  }
  const rows = await db.prepare(
    `SELECT cf.id, cf.booking_id AS bookingId, cf.status, cf.note,
       cf.flagged_by AS flaggedBy, cf.flagged_at AS flaggedAt,
       cf.communicated_by AS communicatedBy, cf.communicated_at AS communicatedAt, cf.communicated_via AS communicatedVia,
       b.code AS bookingCode, b.name AS patientName, b.service, b.desired_date AS desiredDate, b.performed_at AS performedAt
     FROM critical_findings cf
     JOIN bookings b ON b.id = cf.booking_id AND b.organization_id = cf.organization_id
     WHERE cf.organization_id = ? AND cf.status != 'resolved'
     ORDER BY CASE cf.status WHEN 'open' THEN 0 ELSE 1 END, cf.flagged_at DESC LIMIT 200`
  ).bind(ctx.organizationId).all();
  return Response.json({ findings: rows.results || [], staff: ctx.member }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const orgId = ctx.organizationId;
  const email = ctx.member.email;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "");

  if (action === "flag") {
    // Позначення критичної знахідки — клінічний акт (лікар/адмін).
    if (!canManageProtocols(ctx.member.role)) {
      return Response.json({ error: "Позначити критичну знахідку може лише лікар або адміністратор" }, { status: 403 });
    }
    const bookingId = Number(body.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return Response.json({ error: "Некоректна заявка" }, { status: 400 });
    }
    const booking = await db.prepare(
      "SELECT id FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1"
    ).bind(bookingId, orgId).first();
    if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    const note = sanitizeNote(body.note);
    // Один активний запис на заявку; повторне позначення переоткриває.
    await db.prepare(
      `INSERT INTO critical_findings (organization_id, booking_id, status, note, flagged_by)
       VALUES (?, ?, 'open', ?, ?)
       ON CONFLICT(organization_id, booking_id) DO UPDATE SET
         status = 'open', note = excluded.note, flagged_by = excluded.flagged_by,
         flagged_at = CURRENT_TIMESTAMP, communicated_by = '', communicated_at = '',
         communicated_via = '', resolved_by = '', resolved_at = '', updated_at = CURRENT_TIMESTAMP`
    ).bind(orgId, bookingId, note, email).run();
    await audit(db, { organizationId: orgId, actorEmail: email, action: "critical_finding_flagged", resource: "critical_finding", targetId: bookingId });
    return Response.json({ ok: true });
  }

  // communicate / resolve — доведення й закриття; будь-який клінічний персонал.
  if (action === "communicate" || action === "resolve") {
    if (!canWriteNotes(ctx.member.role)) {
      return Response.json({ error: "Дію може виконати лише клінічний персонал" }, { status: 403 });
    }
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Некоректний запис" }, { status: 400 });
    const row = await db.prepare(
      "SELECT status FROM critical_findings WHERE id = ? AND organization_id = ? LIMIT 1"
    ).bind(id, orgId).first<{ status: string }>();
    if (!row) return Response.json({ error: "Запис не знайдено" }, { status: 404 });

    if (action === "communicate") {
      if (row.status !== "open") return Response.json({ error: "Знахідку вже опрацьовано" }, { status: 409 });
      const via = sanitizeVia(body.via);
      if (!via) return Response.json({ error: "Вкажіть, як саме доведено (телефон, особисто тощо)" }, { status: 400 });
      const note = sanitizeNote(body.note);
      await db.prepare(
        `UPDATE critical_findings SET status = 'communicated', communicated_by = ?, communicated_at = CURRENT_TIMESTAMP,
           communicated_via = ?, note = CASE WHEN ? != '' THEN ? ELSE note END, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND organization_id = ? AND status = 'open'`
      ).bind(email, via, note, note, id, orgId).run();
      await audit(db, { organizationId: orgId, actorEmail: email, action: "critical_finding_communicated", resource: "critical_finding", targetId: id, details: { via } });
      return Response.json({ ok: true });
    }

    // resolve
    if (row.status === "resolved") return Response.json({ error: "Знахідку вже закрито" }, { status: 409 });
    await db.prepare(
      `UPDATE critical_findings SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ? AND status != 'resolved'`
    ).bind(email, id, orgId).run();
    await audit(db, { organizationId: orgId, actorEmail: email, action: "critical_finding_resolved", resource: "critical_finding", targetId: id });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Невідома дія" }, { status: 400 });
}
