import {
  normalizeBookingCode,
  requirePatientSession,
} from "../../../lib/patient-auth";
import { isRateLimited } from "../../../lib/rate-limit";
import { stateLabel } from "../../../lib/study-state";
import { dbBinding } from "../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "booking-status", 12, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть перевірку пізніше." }, { status: 429 });
  }
  const session = await requirePatientSession(request, db);
  if (!session) return Response.json({ error: "Сесію завершено. Увійдіть повторно." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { code?: string };
  const code = normalizeBookingCode(body.code);
  if (!code) return Response.json({ error: "Перевірте код заявки" }, { status: 400 });

  const identityClause = session.identityKind === "dob" ? "b.date_of_birth = ?" : "b.code = ?";
  const result = await db.prepare(
    `SELECT b.code, b.service, b.desired_date AS desiredDate, b.desired_time AS desiredTime,
      b.status, b.created_at AS createdAt, COALESCE(o.name, '') AS organization
     FROM bookings b LEFT JOIN organizations o ON o.id = b.organization_id
     WHERE b.organization_id = ? AND b.code = ? AND b.phone_normalized = ? AND ${identityClause}
     LIMIT 1`
  ).bind(session.organizationId, code, session.phoneNormalized, session.identityValue).first<{ status: string }>();
  if (!result) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  const booking = { ...result, statusLabel: stateLabel(result.status) };
  return Response.json({ booking }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "booking-cancel", 6, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть пізніше." }, { status: 429 });
  }
  const session = await requirePatientSession(request, db);
  if (!session) return Response.json({ error: "Сесію завершено. Увійдіть повторно." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { code?: string; action?: string };
  const code = normalizeBookingCode(body.code);
  if (body.action !== "cancel" || !code) {
    return Response.json({ error: "Некоректний запит" }, { status: 400 });
  }
  const identityClause = session.identityKind === "dob" ? "date_of_birth = ?" : "code = ?";
  const booking = await db.prepare(
    `SELECT id, status FROM bookings
     WHERE organization_id = ? AND code = ? AND phone_normalized = ? AND ${identityClause} LIMIT 1`
  ).bind(session.organizationId, code, session.phoneNormalized, session.identityValue).first<{ id: number; status: string }>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  if (!["new", "confirmed", "rescheduled"].includes(booking.status)) {
    return Response.json({ error: "Цю заявку вже не можна скасувати онлайн" }, { status: 409 });
  }
  await db.batch([
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND organization_id = ?").bind(booking.id, session.organizationId),
    db.prepare(
      "INSERT INTO booking_events (organization_id, booking_id, action, details, actor) VALUES (?, ?, 'cancelled', 'patient_self_service', 'patient')"
    ).bind(session.organizationId, booking.id),
  ]);
  return Response.json({ ok: true, status: "cancelled" }, { headers: { "cache-control": "no-store" } });
}
