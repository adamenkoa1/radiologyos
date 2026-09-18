import { logSecurityEvent } from "../../../../../lib/audit";
import { normalizeDob } from "../../../../../lib/dob";
import { dbBinding } from "../../../../../lib/db";
import { normalizeUkrainianPhone } from "../../../../../lib/phone";
import { canManageBookings } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { POST as createStaffBooking } from "../route";

const PATIENT_ID_RE = /^[0-9a-f]{32}$/;

// Exact CRM → booking bridge.
//
// The canonical /api/staff/bookings POST remains the single owner of booking
// rules (schedule, equipment, tariff, staff assignment, capacity). This route
// adds only the immutable-patient precondition and explicit link. It never
// resolves identity by phone: phone/DOB are checked against the selected exact
// profile so a stale hidden patientId cannot silently attach another person.
export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });

  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageBookings(ctx.member.role)) {
    return Response.json({ error: "Створювати записи може реєстратор або адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const patientId = String(body.patientId || "").trim().toLowerCase();
  if (!PATIENT_ID_RE.test(patientId)) {
    return Response.json({ error: "Некоректний ідентифікатор пацієнта" }, { status: 400 });
  }

  const phoneNormalized = normalizeUkrainianPhone(String(body.phone || ""));
  const dob = normalizeDob(body.dob);
  if (!phoneNormalized) return Response.json({ error: "Некоректний номер телефону пацієнта" }, { status: 400 });

  const profile = await db.prepare(
    `SELECT patient_id AS patientId, phone_normalized AS phoneNormalized, birth_date AS birthDate
     FROM patient_profiles
     WHERE organization_id = ? AND patient_id = ? LIMIT 1`
  ).bind(ctx.organizationId, patientId).first<{
    patientId:string; phoneNormalized:string; birthDate:string;
  }>();
  if (!profile) {
    // Keep cross-tenant and nonexistent ids indistinguishable.
    return Response.json({ error: "Картку пацієнта не знайдено" }, { status: 404 });
  }
  if (profile.phoneNormalized !== phoneNormalized) {
    return Response.json({
      error: "Телефон не відповідає вибраній картці пацієнта. Спочатку оновіть картку CRM.",
    }, { status: 409 });
  }
  if (profile.birthDate && dob !== profile.birthDate) {
    return Response.json({
      error: "Дата народження не відповідає вибраній картці пацієнта. Перевірте картку CRM.",
    }, { status: 409 });
  }

  const canonicalRequest = new Request(new URL("/api/staff/bookings", request.url), {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });
  const createdResponse = await createStaffBooking(canonicalRequest);
  const created = await createdResponse.clone().json().catch(() => ({})) as {
    ok?:boolean; code?:string; error?:string;
  };
  if (!createdResponse.ok || !created.ok || !created.code) return createdResponse;

  const booking = await db.prepare(
    `SELECT id, patient_id AS patientId
     FROM bookings WHERE organization_id = ? AND code = ? LIMIT 1`
  ).bind(ctx.organizationId, created.code).first<{ id:number; patientId:string }>();
  if (!booking || booking.patientId) {
    return Response.json({ error: "Не вдалося завершити прив’язку запису до картки пацієнта" }, { status: 500 });
  }

  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE bookings SET patient_id = ?
         WHERE organization_id = ? AND id = ? AND patient_id = ''`
      ).bind(patientId, ctx.organizationId, booking.id),
      db.prepare(
        `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
         VALUES (?, ?, 'patient_linked', ?, ?)`
      ).bind(ctx.organizationId, booking.id, `patient_id=${patientId}`, ctx.member.email),
    ]);
    if (!Number(results[0]?.meta?.changes || 0)) throw new Error("patient link not applied");
  } catch (error) {
    // The booking was created by the canonical route but has not been exposed
    // to the caller yet. Compensate only while it is still unlinked so a
    // failed identity bridge cannot leave a misleading CRM-created booking.
    await db.prepare(
      `DELETE FROM booking_events WHERE organization_id = ? AND booking_id = ?`
    ).bind(ctx.organizationId, booking.id).run().catch(() => undefined);
    await db.prepare(
      `DELETE FROM bookings WHERE organization_id = ? AND id = ? AND patient_id = ''`
    ).bind(ctx.organizationId, booking.id).run().catch(() => undefined);
    console.error("exact_patient_booking_link_failed", booking.id, error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Не вдалося прив’язати запис до картки пацієнта" }, { status: 500 });
  }

  await logSecurityEvent(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "booking_patient_linked",
    resource: "booking",
    targetId: String(booking.id),
    details: { patientId },
  });

  return Response.json({ ...created, bookingId:booking.id, patientId }, { status: 201 });
}
