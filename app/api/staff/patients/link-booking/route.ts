import { logSecurityEvent } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { canManageBookings } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });

  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageBookings(ctx.member.role)) {
    return Response.json({ error: "Прив’язувати заявки до картки пацієнта може реєстратор або адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { bookingId?: unknown; patientId?: unknown };
  const bookingId = Number(body.bookingId);
  const patientId = String(body.patientId || "").trim().toLowerCase();
  if (!Number.isInteger(bookingId) || bookingId < 1 || !/^[0-9a-f]{32}$/.test(patientId)) {
    return Response.json({ error: "Некоректні дані прив’язки" }, { status: 400 });
  }

  const [booking, patient] = await Promise.all([
    db.prepare(
      `SELECT id, patient_id AS patientId
       FROM bookings WHERE organization_id = ? AND id = ? LIMIT 1`
    ).bind(ctx.organizationId, bookingId).first<{ id:number; patientId:string }>(),
    db.prepare(
      `SELECT patient_id AS patientId
       FROM patient_profiles WHERE organization_id = ? AND patient_id = ? LIMIT 1`
    ).bind(ctx.organizationId, patientId).first<{ patientId:string }>(),
  ]);

  // Keep cross-tenant and nonexistent identifiers indistinguishable.
  if (!booking || !patient) {
    return Response.json({ error: "Заявку або картку пацієнта не знайдено" }, { status: 404 });
  }
  if (booking.patientId === patientId) {
    return Response.json({ ok: true, bookingId, patientId, linked: true });
  }
  if (booking.patientId) {
    return Response.json({ error: "Заявка вже прив’язана до іншої картки пацієнта" }, { status: 409 });
  }

  const updated = await db.prepare(
    `UPDATE bookings SET patient_id = ?
     WHERE organization_id = ? AND id = ? AND patient_id = ''`
  ).bind(patientId, ctx.organizationId, bookingId).run();
  if (!updated.meta.changes) {
    return Response.json({ error: "Не вдалося виконати прив’язку" }, { status: 409 });
  }

  await db.prepare(
    `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
     VALUES (?, ?, 'patient_linked', ?, ?)`
  ).bind(ctx.organizationId, bookingId, `patient_id=${patientId}`, ctx.member.email).run();
  await logSecurityEvent(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "booking_patient_linked",
    resource: "booking",
    targetId: String(bookingId),
    details: { patientId },
  });

  return Response.json({ ok: true, bookingId, patientId, linked: true });
}
