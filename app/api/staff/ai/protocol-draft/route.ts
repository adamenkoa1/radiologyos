import { canAccessBooking, canManageProtocols, requireStaff } from "../../../../../lib/staff-auth";
import { sanitizeDocument } from "../../../../../lib/protocols";
import { generateProtocolDraft } from "../../../../../lib/ai";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageProtocols(member.role)) {
    return Response.json({ error: "AI-чернетку може формувати лише лікар або адміністратор" }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return Response.json({ error: "Оберіть дослідження" }, { status: 400 });
  }
  if (!await canAccessBooking(db, member, bookingId)) {
    return Response.json({ error: "Немає доступу до цього дослідження" }, { status: 403 });
  }
  // Draft from whatever is currently in the editor; force draft status so the
  // ready/issued validation never blocks generating a suggestion.
  const parsed = sanitizeDocument({ ...body, status: "draft" });
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  let priorStudies = 0;
  const booking = await db.prepare(
    "SELECT phone_normalized AS phone FROM bookings WHERE id = ? LIMIT 1"
  ).bind(bookingId).first<{ phone: string }>();
  if (booking?.phone) {
    const prior = await db.prepare(
      "SELECT COUNT(*) AS count FROM bookings WHERE phone_normalized = ? AND performed_at != '' AND id != ?"
    ).bind(booking.phone, bookingId).first<{ count: number }>();
    priorStudies = Number(prior?.count || 0);
  }

  const draft = generateProtocolDraft(parsed.document, { priorStudies });

  await db.prepare(
    "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'ai_draft_generated', ?, ?)"
  ).bind(bookingId, `${draft.engine} · відхилень: ${draft.deviations.length}`, member.email).run();

  return Response.json({ ok: true, draft }, { headers: { "cache-control": "no-store" } });
}
