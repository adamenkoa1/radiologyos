import {
  createPatientSession,
  normalizeBookingCode,
  patientSessionCookie,
  requirePatientSession,
} from "../../../lib/patient-auth";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { isRateLimited } from "../../../lib/rate-limit";
import { stateLabel } from "../../../lib/study-state";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "booking-status", 8, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть перевірку пізніше." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({})) as { code?: string; phone?: string };
  const code = normalizeBookingCode(body.code);
  const phoneNormalized = normalizeUkrainianPhone(String(body.phone || ""));
  if (!code || !phoneNormalized) {
    return Response.json({ error: "Перевірте код і повний номер телефону" }, { status: 400 });
  }
  const result = await db.prepare(
    `SELECT b.code, b.service, b.desired_date AS desiredDate, b.desired_time AS desiredTime,
      b.status, b.created_at AS createdAt, COALESCE(o.name, '') AS organization
     FROM bookings b LEFT JOIN organizations o ON o.id = b.organization_id
     WHERE b.code = ? AND b.phone_normalized = ?
     LIMIT 1`
  ).bind(code, phoneNormalized).first<{ status: string }>();
  if (!result) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  // Людський підпис стану дослідження (єдина state machine).
  const booking = { ...result, statusLabel: stateLabel(result.status) };
  const sessionToken = await createPatientSession(db, phoneNormalized);
  return Response.json({ booking }, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": patientSessionCookie(sessionToken),
    },
  });
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
  const booking = await db.prepare(
    `SELECT id, status FROM bookings
     WHERE code = ? AND phone_normalized = ? LIMIT 1`
  ).bind(code, session.phoneNormalized).first<{ id: number; status: string }>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  if (!["new", "confirmed", "rescheduled"].includes(booking.status)) {
    return Response.json({ error: "Цю заявку вже не можна скасувати онлайн" }, { status: 409 });
  }
  await db.batch([
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(booking.id),
    db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'cancelled', 'patient_self_service', 'patient')"
    ).bind(booking.id),
  ]);
  return Response.json({ ok: true, status: "cancelled" }, { headers: { "cache-control": "no-store" } });
}
