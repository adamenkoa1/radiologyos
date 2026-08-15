import { canAccessBooking, canManageProtocols } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { sanitizeDocument } from "../../../../../lib/protocols";
import { generateProtocolDraft } from "../../../../../lib/ai";
import { dbBinding } from "../../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageProtocols(member.role)) {
    return Response.json({ error: "AI-чернетку може формувати лише лікар або адміністратор" }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return Response.json({ error: "Оберіть дослідження" }, { status: 400 });
  }
  // Tenant-guard: admin/registrar не мають доступу до чужої організації.
  if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
    return Response.json({ error: "Немає доступу до цього дослідження" }, { status: 403 });
  }
  // Draft from whatever is currently in the editor; force draft status so the
  // ready/issued validation never blocks generating a suggestion.
  const parsed = sanitizeDocument({ ...body, status: "draft" });
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  let priorStudies = 0;
  const booking = await db.prepare(
    `SELECT phone_normalized AS phone, date_of_birth AS dob
     FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1`
  ).bind(bookingId, ctx.organizationId).first<{ phone: string; dob: string }>();
  // A phone number can be shared by family members. Only use prior studies as
  // AI context when the tenant-local booking identity also matches DOB. If DOB
  // is absent, fail closed instead of treating the phone as a patient id.
  if (booking?.phone && booking.dob) {
    const prior = await db.prepare(
      `SELECT COUNT(*) AS count FROM bookings
       WHERE phone_normalized = ? AND date_of_birth = ?
         AND performed_at != '' AND id != ? AND organization_id = ?`
    ).bind(booking.phone, booking.dob, bookingId, ctx.organizationId).first<{ count: number }>();
    priorStudies = Number(prior?.count || 0);
  }

  const draft = generateProtocolDraft(parsed.document, { priorStudies });

  await db.prepare(
    "INSERT INTO booking_events (organization_id, booking_id, action, details, actor) VALUES (?, ?, 'ai_draft_generated', ?, ?)"
  ).bind(ctx.organizationId, bookingId, `${draft.engine} · відхилень: ${draft.deviations.length}`, member.email).run();

  return Response.json({ ok: true, draft }, { headers: { "cache-control": "no-store" } });
}
