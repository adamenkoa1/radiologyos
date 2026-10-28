import { effectiveServiceByCode } from "../../../../../lib/effective-services";
import { normalizeUkrainianPhone } from "../../../../../lib/phone";
import { normalizeDob } from "../../../../../lib/dob";
import { nextBookingCode } from "../../../../../lib/booking-code";
import { canManageBookings } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { dbBinding } from "../../../../../lib/db";
import { audit } from "../../../../../lib/audit";
import { serializeRegions, sanitizeContrast } from "../../../../../lib/study-attributes";

// Швидке (walk-in) створення дослідження прямо з робочого місця лікаря
// (/staff/protocols). Пацієнт уже присутній/ретроспективно — БЕЗ вибору слота,
// без рентгенлаборанта й перевірки конфліктів розкладу. Дослідження одразу
// позначається виконаним (performed_at=now, status='completed'), тож зразу
// потрапляє в чергу протоколів «Очікують». Запланований шлях (слоти/лаборант/
// конфлікти) лишається окремо в реєстраторському формулярі.
//
// Межі: створювати може лише admin/registrar (canManageBookings) — межа ролей
// не розширюється; tenant із сесії; нічого не підписується. Клінічний lifecycle
// протоколу не зачіпається (рядок protocols з'являється лише коли лікар збереже).

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageBookings(member.role)) {
    return Response.json({ error: "Створювати дослідження може реєстратор або адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const phoneNormalized = normalizeUkrainianPhone(phone);
  const dob = normalizeDob(body.dob);
  const serviceCode = clean(body.serviceCode, 24);
  const clinicalIndication = clean(body.clinicalIndication, 400);
  const category = clean(body.patientCategory, 20) === "military" ? "military" : "civilian";
  const radiologist = clean(body.assignedRadiologistEmail, 254).toLowerCase();
  const patientId = clean(body.patientId, 64).toLowerCase();
  // Структуровані параметри дослідження — лише з явного вводу, не з тексту.
  const anatomicalRegions = serializeRegions(body.anatomicalRegions);
  const contrastMethod = sanitizeContrast(body.contrastMethod);

  const service = await effectiveServiceByCode(db, serviceCode, ctx.organizationId);
  if (!name || !phoneNormalized || !service) {
    return Response.json({ error: "Вкажіть імʼя, телефон і послугу" }, { status: 400 });
  }

  // Призначений лікар (необов'язково) має бути активним рентгенологом цього tenant.
  if (radiologist) {
    const ok = await db.prepare(
      `SELECT 1 FROM memberships m JOIN staff_members s ON s.email = m.member_email AND s.active = 1
       WHERE m.organization_id = ? AND m.member_email = ? AND m.role = 'radiologist' AND m.active = 1 LIMIT 1`
    ).bind(ctx.organizationId, radiologist).first();
    if (!ok) return Response.json({ error: "Оберіть активного лікаря-рентгенолога цієї організації" }, { status: 400 });
  }
  // Прив'язка до наявної картки пацієнта (необов'язково) — лише в межах tenant.
  if (patientId) {
    const ok = await db.prepare(
      "SELECT 1 FROM patient_profiles WHERE organization_id = ? AND patient_id = ? LIMIT 1"
    ).bind(ctx.organizationId, patientId).first();
    if (!ok) return Response.json({ error: "Пацієнта не знайдено в цій організації" }, { status: 400 });
  }

  const code = await nextBookingCode(db);
  const result = await db.prepare(
    `INSERT INTO bookings (
       organization_id, code, name, phone, phone_normalized, date_of_birth, service, service_code, equipment_id,
       duration_minutes, desired_date, desired_time, referral, patient_category, clinical_indication,
       anatomical_regions, contrast_method,
       assigned_radiologist_email, status, performed_at, patient_id, consent_at, consent_source
     ) VALUES (?,?,?,?,?,?,?,?,?,?, date('now'), strftime('%H:%M','now'), 'Walk-in / без онлайн-заявки', ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, 'staff_walkin')`
  ).bind(
    ctx.organizationId, code, name, phone, phoneNormalized, dob, service.title, service.code, service.equipmentId,
    service.durationMinutes, category, clinicalIndication, anatomicalRegions, contrastMethod, radiologist, patientId,
  ).run();
  const bookingId = Number(result.meta.last_row_id);

  await audit(db, {
    action: "booking_walkin_created",
    resource: "booking",
    actorEmail: member.email,
    organizationId: ctx.organizationId,
    targetId: String(bookingId),
    details: { code, service: service.title, category },
  });

  return Response.json({ ok: true, bookingId, code }, { headers: { "cache-control": "no-store" } });
}
