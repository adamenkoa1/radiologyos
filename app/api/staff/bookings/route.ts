import { addMinutes, serviceByCode } from "../../../../lib/catalog";
import { isBookableDate, isTimeForService } from "../../../../lib/booking-rules";
import { canManageBookings, canWriteNotes, requireStaff } from "../../../../lib/staff-auth";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  const [result, events, notes] = await Promise.all([
    db.prepare(
      `SELECT id, code, name, phone, service, service_code AS serviceCode,
        equipment_id AS equipmentId, duration_minutes AS durationMinutes,
        desired_date AS desiredDate, desired_time AS desiredTime, referral,
        patient_category AS patientCategory, referral_type AS referralType,
        referral_number AS referralNumber, marketing_source AS marketingSource,
        comment, status, created_at AS createdAt
       FROM bookings ORDER BY created_at DESC LIMIT 500`
    ).all(),
    db.prepare(
      `SELECT id, booking_id AS bookingId, action, details, actor, created_at AS createdAt
       FROM booking_events ORDER BY created_at DESC LIMIT 1000`
    ).all(),
    db.prepare(
      `SELECT booking_id AS bookingId, note, updated_by AS updatedBy, updated_at AS updatedAt
       FROM booking_staff_notes`
    ).all(),
  ]);
  return Response.json({
    bookings: result.results,
    events: events.results,
    notes: notes.results,
    staff: member,
  });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const body = await request.json() as { id?: number; status?: string; desiredDate?: string; desiredTime?: string; note?: string };
  if (!Number.isInteger(body.id)) return Response.json({ error: "Некоректні дані" }, { status: 400 });

  if (typeof body.note === "string") {
    if (!canWriteNotes(member.role)) return Response.json({ error: "Недостатньо прав" }, { status: 403 });
    const note = body.note.trim().slice(0, 1200);
    await db.prepare(
      `INSERT INTO booking_staff_notes (booking_id, note, updated_by, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(booking_id) DO UPDATE SET note=excluded.note, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`
    ).bind(body.id, note, member.email).run();
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'staff_note', 'updated', ?)"
    ).bind(body.id, member.email).run();
    return Response.json({ ok: true });
  }

  if (!canManageBookings(member.role)) return Response.json({ error: "Недостатньо прав" }, { status: 403 });

  if (body.desiredDate && body.desiredTime) {
    const booking = await db.prepare(
      "SELECT service_code AS serviceCode, equipment_id AS equipmentId, duration_minutes AS durationMinutes FROM bookings WHERE id = ?"
    ).bind(body.id).first<{serviceCode:string;equipmentId:string;durationMinutes:number}>();
    const service = booking && serviceByCode(booking.serviceCode);
    if (!booking || !service || !isBookableDate(body.desiredDate) || !isTimeForService(body.desiredTime, booking.serviceCode)) {
      return Response.json({ error: "Некоректні дата або час" }, { status: 400 });
    }
    const endTime = addMinutes(body.desiredTime, booking.durationMinutes);
    const conflict = await db.prepare(
      `SELECT id FROM bookings WHERE equipment_id = ? AND desired_date = ? AND id != ?
       AND status NOT IN ('cancelled','completed') AND desired_time < ?
       AND time(desired_time, '+' || duration_minutes || ' minutes') > ? LIMIT 1`
    ).bind(booking.equipmentId, body.desiredDate, body.id, endTime, body.desiredTime).first();
    if (conflict) return Response.json({ error: "Цей час уже зайнятий на обраному апараті" }, { status: 409 });
    const blocked = await db.prepare(
      `SELECT id FROM equipment_blocks WHERE equipment_id = ? AND blocked_date = ?
       AND start_time < ? AND end_time > ? LIMIT 1`
    ).bind(booking.equipmentId, body.desiredDate, endTime, body.desiredTime).first();
    if (blocked) return Response.json({ error: "Апарат недоступний у цей період" }, { status: 409 });
    await db.prepare(
      "UPDATE bookings SET desired_date = ?, desired_time = ?, status = 'rescheduled' WHERE id = ?"
    ).bind(body.desiredDate, body.desiredTime, body.id).run();
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'rescheduled', ?, ?)"
    ).bind(body.id, `${body.desiredDate} ${body.desiredTime}`, member.email).run();
    return Response.json({ ok: true, status: "rescheduled" });
  }

  const allowed = new Set(["new", "confirmed", "rescheduled", "completed", "cancelled"]);
  if (!body.status || !allowed.has(body.status)) return Response.json({ error: "Некоректний статус" }, { status: 400 });
  const updated = await db.prepare("UPDATE bookings SET status = ? WHERE id = ?").bind(body.status, body.id).run();
  if (!updated.meta.changes) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  await db.prepare(
    "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'status_changed', ?, ?)"
  ).bind(body.id, body.status, member.email).run();
  return Response.json({ ok: true });
}
