import { sendPatientMessage, type ReminderBooking } from "../../../../lib/notify";
import { canAccessBooking, canWriteNotes, type StaffRole } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";

// Разове повідомлення пацієнту, ініційоване персоналом (результат готовий,
// затримка, жива черга тощо) — окремо від автопідтвердження. Admin/registrar
// можуть працювати з усією tenant-чергою; клінічні ролі — лише з призначеними
// їм заявками через ту саму security primitive, що й протоколи/PACS.
export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canWriteNotes(ctx.member.role as StaffRole)) {
    return Response.json({ error: "Недостатньо прав" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { bookingId?: unknown; message?: unknown };
  const bookingId = Number(body.bookingId);
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return Response.json({ error: "Некоректна заявка" }, { status: 400 });
  }
  if (message.length < 3) {
    return Response.json({ error: "Введіть текст повідомлення" }, { status: 400 });
  }
  if (!(await canAccessBooking(db, ctx.member, bookingId, ctx.organizationId))) {
    return Response.json({ error: "Заявку не знайдено або її не призначено вам" }, { status: 404 });
  }

  const booking = await db.prepare(
    `SELECT id, name, phone, phone_normalized AS phoneNormalized, patient_email AS patientEmail,
            service, desired_date AS desiredDate, desired_time AS desiredTime
     FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1`
  ).bind(bookingId, ctx.organizationId).first<ReminderBooking>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });

  const summary = await sendPatientMessage(db, booking, message);
  await db.prepare(
    `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
     VALUES (?, ?, 'notified', ?, ?)`
  ).bind(ctx.organizationId, bookingId, `Повідомлення пацієнту: ${message}`.slice(0, 480), ctx.member.email).run();

  return Response.json({ ok: true, summary }, { headers: { "cache-control": "no-store" } });
}
