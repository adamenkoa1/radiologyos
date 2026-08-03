import { addMinutes, serviceByCode } from "../../../../lib/catalog";
import { isBookableDate } from "../../../../lib/booking-rules";
import { candidateTimesFor, hoursFor, isEquipmentDayOpen, parseSchedule, SCHEDULE_KEY } from "../../../../lib/schedule";
import { getSetting } from "../../../../lib/settings";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { normalizeDob } from "../../../../lib/dob";
import { effectivePrice } from "../../../../lib/tariffs";
import { sendPatientReminder, type ReminderBooking } from "../../../../lib/notify";
import { canTransition, isStudyState, stateLabel } from "../../../../lib/study-state";
import {
  canManageBookings,
  canManageFinance,
  canManageProtocols,
  canAccessBooking,
  canWriteNotes,
  type StaffRole,
} from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const REFERRAL_TYPES = ["military_referral", "eh_referral", "paper_referral", "none", "other"];

// Ручне створення запису персоналом від імені пацієнта. Реєстратор/медсестра або адмін.
// Запис одразу підтверджений (status='confirmed'), тож займає слот на апараті.
export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageBookings(member.role)) {
    return Response.json({ error: "Створювати записи може реєстратор, медсестра з правами реєстратора або адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const phoneNormalized = normalizeUkrainianPhone(phone);
  const dob = normalizeDob(body.dob);
  const serviceCode = clean(body.serviceCode, 12);
  const service = serviceByCode(serviceCode);
  const desiredDate = clean(body.date, 10);
  const desiredTime = clean(body.time, 5);
  const category = clean(body.patientCategory, 20) === "military" ? "military" : "civilian";
  let referralType = clean(body.referralType, 30);
  if (!REFERRAL_TYPES.includes(referralType)) referralType = "none";
  const comment = clean(body.comment, 700);
  let radiologist = clean(body.assignedRadiologistEmail, 254).toLowerCase();
  let radiographer = clean(body.assignedRadiographerEmail, 254).toLowerCase();

  if (!name || !phoneNormalized || !service) {
    return Response.json({ error: "Вкажіть імʼя, телефон і послугу" }, { status: 400 });
  }
  const schedule = parseSchedule(await getSetting(db, SCHEDULE_KEY));
  radiologist ||= schedule.equipment[service.equipmentId]?.radiologistEmail || "";
  radiographer ||= schedule.equipment[service.equipmentId]?.radiographerEmail || "";
  const validTimes = candidateTimesFor(hoursFor(schedule, service.equipmentId), service.durationMinutes);
  if (!isBookableDate(desiredDate) || !validTimes.includes(desiredTime) || !isEquipmentDayOpen(desiredDate, schedule, service.equipmentId)) {
    return Response.json({ error: "Оберіть доступні дату та час" }, { status: 400 });
  }

  const endTime = addMinutes(desiredTime, service.durationMinutes);
  const conflict = await db.prepare(
    `SELECT id FROM bookings WHERE equipment_id = ? AND desired_date = ?
     AND status IN ('confirmed','rescheduled') AND desired_time < ?
     AND strftime('%H:%M', desired_time, '+' || duration_minutes || ' minutes') > ? LIMIT 1`
  ).bind(service.equipmentId, desiredDate, endTime, desiredTime).first();
  if (conflict) return Response.json({ error: "Цей час уже зайнятий на обраному апараті" }, { status: 409 });
  const blocked = await db.prepare(
    "SELECT id FROM equipment_blocks WHERE equipment_id = ? AND blocked_date = ? AND start_time < ? AND end_time > ? LIMIT 1"
  ).bind(service.equipmentId, desiredDate, endTime, desiredTime).first();
  if (blocked) return Response.json({ error: "Апарат недоступний у цей період" }, { status: 409 });

  const code = `RD-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  const price = await effectivePrice(db, service.code);
  const paymentStatus = category === "civilian" ? "pending" : "verification_required";
  const nszuStatus = referralType === "eh_referral" ? "pending" : "not_applicable";
  const referral = referralType === "none" ? "Немає направлення" : referralType;

  const result = await db.prepare(
    `INSERT INTO bookings (
      organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id,
      duration_minutes, desired_date, desired_time, referral, patient_category, referral_type,
      payment_status, payment_amount, nszu_status, comment, date_of_birth,
      assigned_radiologist_email, assigned_radiographer_email, status,
      consent_at, consent_version, consent_source
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'confirmed',CURRENT_TIMESTAMP,?,?)`
  ).bind(
    ctx.organizationId, code, name, phone, phoneNormalized, service.title, service.code, service.equipmentId,
    service.durationMinutes, desiredDate, desiredTime, referral, category, referralType,
    paymentStatus, price, nszuStatus, comment, dob,
    radiologist, radiographer, "2026-07-29", "staff",
  ).run();

  const bookingId = result.meta.last_row_id;
  if (bookingId) {
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'created_by_staff', ?, ?)"
    ).bind(bookingId, `Запис від імені пацієнта: ${service.code} ${desiredDate} ${desiredTime}`, member.email).run();
  }
  return Response.json({ ok: true, code }, { status: 201 });
}

// Область видимості заявок: спершу tenant (organization_id зі серверного
// контексту), далі — рольове обмеження. Персонал не бачить чужих організацій.
function bookingScope(member: { email: string; role: StaffRole }, organizationId: number) {
  const role = (member.role === "admin" || member.role === "registrar")
    ? { sql: "1 = 1", values: [] as Array<string | number> }
    : member.role === "radiologist"
      ? { sql: "assigned_radiologist_email = ?", values: [member.email] as Array<string | number> }
      : { sql: "assigned_radiographer_email = ?", values: [member.email] as Array<string | number> };
  return { sql: `organization_id = ? AND (${role.sql})`, values: [organizationId, ...role.values] };
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const scope = bookingScope(member, ctx.organizationId);

  const [result, events, notes, staffOptions, notifications] = await Promise.all([
    db.prepare(
      `SELECT id, code, name, phone, patient_email AS patientEmail, service, service_code AS serviceCode,
        equipment_id AS equipmentId, duration_minutes AS durationMinutes,
        desired_date AS desiredDate, desired_time AS desiredTime, referral,
        patient_category AS patientCategory, referral_type AS referralType,
        referral_number AS referralNumber, marketing_source AS marketingSource,
        protocol_number AS protocolNumber, protocol_status AS protocolStatus,
        protocol_updated_at AS protocolUpdatedAt, payment_status AS paymentStatus,
        payment_amount AS paymentAmount, payment_method AS paymentMethod,
        nszu_status AS nszuStatus, nszu_reference AS nszuReference,
        assigned_radiologist_email AS assignedRadiologistEmail,
        assigned_radiographer_email AS assignedRadiographerEmail,
        performed_at AS performedAt, anatomical_regions_count AS anatomicalRegionsCount,
        protocol_ready_at AS protocolReadyAt, protocol_issued_at AS protocolIssuedAt,
        paid_amount AS paidAmount, external_reference AS externalReference,
        date_of_birth AS dateOfBirth,
        comment, status, created_at AS createdAt
       FROM bookings WHERE ${scope.sql} ORDER BY created_at DESC LIMIT 500`
    ).bind(...scope.values).all(),
    db.prepare(
      `SELECT id, booking_id AS bookingId, action, details, actor, created_at AS createdAt
       FROM booking_events
       WHERE booking_id IN (SELECT id FROM bookings WHERE ${scope.sql})
       ORDER BY created_at DESC LIMIT 1000`
    ).bind(...scope.values).all(),
    db.prepare(
      `SELECT booking_id AS bookingId, note, updated_by AS updatedBy, updated_at AS updatedAt
       FROM booking_staff_notes
       WHERE booking_id IN (SELECT id FROM bookings WHERE ${scope.sql})`
    ).bind(...scope.values).all(),
    db.prepare(
      `SELECT email, display_name AS displayName, role
       FROM staff_members WHERE active = 1 ORDER BY role, display_name, email`
    ).all(),
    db.prepare(
      `SELECT id, booking_id AS bookingId, kind, channel, recipient, status, error,
        created_at AS createdAt, sent_at AS sentAt
       FROM patient_notifications
       WHERE booking_id IN (SELECT id FROM bookings WHERE ${scope.sql})
       ORDER BY created_at DESC LIMIT 1000`
    ).bind(...scope.values).all(),
  ]);
  const bookings = (result.results as Array<Record<string, unknown>>).map((booking) => ({
    ...booking,
    listedPrice: serviceByCode(String(booking.serviceCode))?.price || Number(booking.paymentAmount) || 0,
  }));
  return Response.json({
    bookings,
    events: events.results,
    notes: notes.results,
    staffOptions: staffOptions.results,
    notifications: notifications.results,
    staff: member,
  });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const body = await request.json() as {
    id?: number;
    status?: string;
    confirm?: boolean;
    desiredDate?: string;
    desiredTime?: string;
    note?: string;
    protocolNumber?: string;
    protocolStatus?: string;
    paymentStatus?: string;
    paymentAmount?: number;
    paidAmount?: number;
    paymentMethod?: string;
    nszuStatus?: string;
    nszuReference?: string;
    assignedRadiologistEmail?: string;
    assignedRadiographerEmail?: string;
    performedAt?: string;
    anatomicalRegionsCount?: number;
    externalReference?: string;
    edit?: {
      name?: string; phone?: string; email?: string; dob?: string;
      patientCategory?: string; serviceCode?: string; comment?: string;
    };
  };
  if (!Number.isInteger(body.id)) return Response.json({ error: "Некоректні дані" }, { status: 400 });
  if (!(await canAccessBooking(db, member, body.id!, ctx.organizationId))) {
    return Response.json({ error: "Заявку не знайдено або її не призначено вам" }, { status: 404 });
  }

  // Повна корекція заявки: ПІБ, телефон, email, ДН, категорія, послуга,
  // коментар. Лише реєстратор/адміністратор. Зміна послуги переобчислює
  // апарат, тривалість і суму; зміна категорії — статус оплати (окрім уже
  // оплачених). Якщо нова послуга змінює апарат — перевіряємо, що поточний
  // слот вільний на новому апараті.
  if (body.edit && typeof body.edit === "object") {
    if (!canManageBookings(member.role)) {
      return Response.json({ error: "Редагувати заявку може реєстратор або адміністратор" }, { status: 403 });
    }
    const cur = await db.prepare(
      "SELECT desired_date AS d, desired_time AS t, equipment_id AS eq, payment_status AS ps FROM bookings WHERE id = ?"
    ).bind(body.id!).first<{ d: string; t: string; eq: string; ps: string }>();
    // Фінанси не перезаписуємо, якщо оплату вже внесено/не потрібна.
    const financeLocked = !!cur && ["paid", "not_required"].includes(cur.ps);
    const e = body.edit;
    const sets: string[] = [];
    const binds: (string | number)[] = [];
    if (typeof e.name === "string") { sets.push("name = ?"); binds.push(e.name.trim().slice(0, 120)); }
    if (typeof e.phone === "string") {
      const ph = e.phone.trim().slice(0, 40);
      const norm = normalizeUkrainianPhone(ph);
      if (!norm) return Response.json({ error: "Некоректний номер телефону" }, { status: 400 });
      sets.push("phone = ?", "phone_normalized = ?"); binds.push(ph, norm);
    }
    if (typeof e.email === "string") { sets.push("patient_email = ?"); binds.push(e.email.trim().slice(0, 254)); }
    if (typeof e.dob === "string") { sets.push("date_of_birth = ?"); binds.push(normalizeDob(e.dob)); }
    if (typeof e.patientCategory === "string") {
      const cat = e.patientCategory === "military" ? "military" : "civilian";
      sets.push("patient_category = ?"); binds.push(cat);
      if (!financeLocked) { sets.push("payment_status = ?"); binds.push(cat === "civilian" ? "pending" : "verification_required"); }
    }
    if (typeof e.comment === "string") { sets.push("comment = ?"); binds.push(e.comment.trim().slice(0, 700)); }
    if (typeof e.serviceCode === "string") {
      const svc = serviceByCode(e.serviceCode.trim().slice(0, 12));
      if (!svc) return Response.json({ error: "Невідома послуга" }, { status: 400 });
      // Зміна апарата: поточний слот має бути вільним на новому апараті.
      if (cur && svc.equipmentId !== cur.eq) {
        const endTime = addMinutes(cur.t, svc.durationMinutes);
        const clash = await db.prepare(
          `SELECT id FROM bookings WHERE equipment_id = ? AND desired_date = ? AND id != ?
           AND status IN ('confirmed','rescheduled') AND desired_time < ?
           AND strftime('%H:%M', desired_time, '+' || duration_minutes || ' minutes') > ? LIMIT 1`
        ).bind(svc.equipmentId, cur.d, body.id!, endTime, cur.t).first();
        if (clash) return Response.json({ error: "Час зайнятий на апараті нової послуги — спершу перенесіть заявку" }, { status: 409 });
      }
      sets.push("service = ?", "service_code = ?", "equipment_id = ?", "duration_minutes = ?");
      binds.push(svc.title, svc.code, svc.equipmentId, svc.durationMinutes);
      if (!financeLocked) { sets.push("payment_amount = ?"); binds.push(await effectivePrice(db, svc.code)); }
    }
    if (!sets.length) return Response.json({ error: "Немає змін для збереження" }, { status: 400 });
    binds.push(body.id!);
    await db.prepare(`UPDATE bookings SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'edited', ?, ?)"
    ).bind(body.id!, `Скориговано поля: ${Object.keys(e).join(", ")}`, member.email).run();
    return Response.json({ ok: true });
  }

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

  if (
    typeof body.assignedRadiologistEmail === "string" ||
    typeof body.assignedRadiographerEmail === "string"
  ) {
    if (!canManageBookings(member.role)) {
      return Response.json({ error: "Виконавців може призначати лише реєстратор або адміністратор" }, { status: 403 });
    }
    const radiologistEmail = String(body.assignedRadiologistEmail || "").trim().toLowerCase().slice(0, 254);
    const radiographerEmail = String(body.assignedRadiographerEmail || "").trim().toLowerCase().slice(0, 254);
    if (radiologistEmail) {
      const radiologist = await db.prepare(
        "SELECT email FROM staff_members WHERE email = ? AND role = 'radiologist' AND active = 1"
      ).bind(radiologistEmail).first();
      if (!radiologist) return Response.json({ error: "Оберіть активного лікаря-рентгенолога" }, { status: 400 });
    }
    if (radiographerEmail) {
      const radiographer = await db.prepare(
        "SELECT email FROM staff_members WHERE email = ? AND role = 'radiographer' AND active = 1"
      ).bind(radiographerEmail).first();
      if (!radiographer) return Response.json({ error: "Оберіть активного рентгенолаборанта" }, { status: 400 });
    }
    const updated = await db.prepare(
      `UPDATE bookings SET assigned_radiologist_email = ?,
       assigned_radiographer_email = ? WHERE id = ?`
    ).bind(radiologistEmail, radiographerEmail, body.id).run();
    if (!updated.meta.changes) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'staff_assigned', ?, ?)"
    ).bind(
      body.id,
      `radiologist=${radiologistEmail || "none"}; radiographer=${radiographerEmail || "none"}`,
      member.email
    ).run();
    return Response.json({ ok: true, assignedRadiologistEmail: radiologistEmail, assignedRadiographerEmail: radiographerEmail });
  }

  if (
    typeof body.performedAt === "string" ||
    typeof body.anatomicalRegionsCount === "number" ||
    typeof body.externalReference === "string"
  ) {
    if (!canWriteNotes(member.role)) return Response.json({ error: "Недостатньо прав" }, { status: 403 });
    const performedAt = String(body.performedAt || "").trim().slice(0, 19);
    const anatomicalRegionsCount = Number(body.anatomicalRegionsCount);
    const externalReference = String(body.externalReference || "").trim().slice(0, 120);
    if (performedAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(performedAt)) {
      return Response.json({ error: "Некоректні дата або час виконання" }, { status: 400 });
    }
    if (!Number.isInteger(anatomicalRegionsCount) || anatomicalRegionsCount < 1 || anatomicalRegionsCount > 20) {
      return Response.json({ error: "Кількість анатомічних ділянок має бути від 1 до 20" }, { status: 400 });
    }
    const updated = await db.prepare(
      `UPDATE bookings SET performed_at = ?, anatomical_regions_count = ?,
       external_reference = ?, status = CASE WHEN ? != '' THEN 'completed' ELSE status END
       WHERE id = ?`
    ).bind(performedAt, anatomicalRegionsCount, externalReference, performedAt, body.id).run();
    if (!updated.meta.changes) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'execution_recorded', ?, ?)"
    ).bind(
      body.id,
      `${performedAt || "not performed"} · regions=${anatomicalRegionsCount}${externalReference ? ` · document=${externalReference}` : ""}`,
      member.email
    ).run();
    return Response.json({
      ok: true,
      performedAt,
      anatomicalRegionsCount,
      externalReference,
      ...(performedAt ? { status:"completed" } : {}),
    });
  }

  if (typeof body.protocolStatus === "string" || typeof body.protocolNumber === "string") {
    if (!canManageProtocols(member.role)) {
      return Response.json({ error: "Протоколи може змінювати лише лікар або адміністратор" }, { status: 403 });
    }
    const protocolStatuses = new Set(["not_started", "in_progress", "ready", "issued"]);
    const protocolStatus = String(body.protocolStatus || "");
    const protocolNumber = String(body.protocolNumber || "").trim().slice(0, 80);
    if (!protocolStatuses.has(protocolStatus)) {
      return Response.json({ error: "Некоректний статус протоколу" }, { status: 400 });
    }
    if ((protocolStatus === "ready" || protocolStatus === "issued") && !protocolNumber) {
      return Response.json({ error: "Для готового або виданого протоколу вкажіть його номер" }, { status: 400 });
    }
    const current = await db.prepare(
      "SELECT protocol_status AS protocolStatus FROM bookings WHERE id = ? LIMIT 1"
    ).bind(body.id).first<{ protocolStatus: string }>();
    const protocolTransitions: Record<string, string[]> = {
      not_started: ["in_progress"],
      in_progress: ["ready"],
      ready: ["issued"],
      issued: [],
    };
    if (
      current
      && protocolStatus !== current.protocolStatus
      && !(protocolTransitions[current.protocolStatus] || []).includes(protocolStatus)
    ) {
      return Response.json({ error: "Неможливо повернути протокол до попереднього статусу" }, { status: 409 });
    }
    const updated = await db.prepare(
      `UPDATE bookings SET protocol_number = ?, protocol_status = ?,
       protocol_updated_at = CURRENT_TIMESTAMP,
       protocol_ready_at = CASE
         WHEN ? IN ('ready','issued') AND protocol_ready_at = '' THEN CURRENT_TIMESTAMP
         ELSE protocol_ready_at END,
       protocol_issued_at = CASE
         WHEN ? = 'issued' AND protocol_issued_at = '' THEN CURRENT_TIMESTAMP
         ELSE protocol_issued_at END
       WHERE id = ?`
    ).bind(protocolNumber, protocolStatus, protocolStatus, protocolStatus, body.id).run();
    if (!updated.meta.changes) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'protocol_updated', ?, ?)"
    ).bind(body.id, `${protocolStatus}${protocolNumber ? ` · ${protocolNumber}` : ""}`, member.email).run();
    const protocolDates = await db.prepare(
      "SELECT protocol_ready_at AS protocolReadyAt, protocol_issued_at AS protocolIssuedAt FROM bookings WHERE id = ?"
    ).bind(body.id).first<{protocolReadyAt:string;protocolIssuedAt:string}>();
    return Response.json({ ok: true, protocolNumber, protocolStatus, ...protocolDates });
  }

  if (
    typeof body.paymentStatus === "string" ||
    typeof body.paymentAmount === "number" ||
    typeof body.paidAmount === "number" ||
    typeof body.paymentMethod === "string" ||
    typeof body.nszuStatus === "string" ||
    typeof body.nszuReference === "string"
  ) {
    if (!canManageFinance(member.role)) {
      return Response.json({ error: "Розрахунки та НСЗУ може змінювати лише реєстратор або адміністратор" }, { status: 403 });
    }
    const paymentStatuses = new Set(["not_set", "verification_required", "pending", "paid", "not_required", "refunded"]);
    const paymentMethods = new Set(["", "cash", "card", "bank_transfer", "privat_link", "other"]);
    const nszuStatuses = new Set(["not_applicable", "pending", "confirmed", "rejected"]);
    const paymentStatus = String(body.paymentStatus || "");
    const paymentMethod = String(body.paymentMethod || "");
    const nszuStatus = String(body.nszuStatus || "");
    const nszuReference = String(body.nszuReference || "").trim().slice(0, 80);
    const paymentAmount = Number(body.paymentAmount);
    const paidAmount = Number(body.paidAmount);
    if (
      !paymentStatuses.has(paymentStatus) ||
      !paymentMethods.has(paymentMethod) ||
      !nszuStatuses.has(nszuStatus) ||
      !Number.isInteger(paymentAmount) ||
      paymentAmount < 0 ||
      paymentAmount > 100000 ||
      !Number.isInteger(paidAmount) ||
      paidAmount < 0 ||
      paidAmount > 100000
    ) {
      return Response.json({ error: "Некоректні дані оплати або НСЗУ" }, { status: 400 });
    }
    if (paymentStatus === "paid" && paidAmount === 0) {
      return Response.json({ error: "Для оплаченої послуги вкажіть фактично сплачену суму" }, { status: 400 });
    }
    const updated = await db.prepare(
      `UPDATE bookings SET payment_status = ?, payment_amount = ?, paid_amount = ?, payment_method = ?,
       nszu_status = ?, nszu_reference = ?,
       military_verified_at = CASE
         WHEN patient_category = 'military' AND ? = 'not_required' THEN CURRENT_TIMESTAMP
         ELSE military_verified_at END,
       military_verified_by = CASE
         WHEN patient_category = 'military' AND ? = 'not_required' THEN ?
         ELSE military_verified_by END
       WHERE id = ?`
    ).bind(
      paymentStatus, paymentAmount, paidAmount, paymentMethod, nszuStatus, nszuReference,
      paymentStatus, paymentStatus, member.email, body.id,
    ).run();
    if (!updated.meta.changes) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'finance_updated', ?, ?)"
    ).bind(body.id, `${paymentStatus} · paid=${paidAmount} грн · ${nszuStatus}`, member.email).run();
    return Response.json({ ok: true, paymentStatus, paymentAmount, paidAmount, paymentMethod, nszuStatus, nszuReference });
  }

  if (!canManageBookings(member.role)) return Response.json({ error: "Недостатньо прав" }, { status: 403 });

  if (body.desiredDate && body.desiredTime) {
    const booking = await db.prepare(
      `SELECT service_code AS serviceCode, equipment_id AS equipmentId, duration_minutes AS durationMinutes,
        name, phone, phone_normalized AS phoneNormalized, patient_email AS patientEmail, service
       FROM bookings WHERE id = ?`
    ).bind(body.id).first<{serviceCode:string;equipmentId:string;durationMinutes:number;name:string;phone:string;phoneNormalized:string;patientEmail:string;service:string}>();
    const service = booking && serviceByCode(booking.serviceCode);
    const rSched = parseSchedule(await getSetting(db, SCHEDULE_KEY));
    if (!booking || !service || !isBookableDate(body.desiredDate) || !isEquipmentDayOpen(body.desiredDate, rSched, service.equipmentId)
        || !candidateTimesFor(hoursFor(rSched, service.equipmentId), booking.durationMinutes).includes(body.desiredTime)) {
      return Response.json({ error: "Некоректні дата або час" }, { status: 400 });
    }
    const endTime = addMinutes(body.desiredTime, booking.durationMinutes);
    const conflict = await db.prepare(
      `SELECT id FROM bookings WHERE equipment_id = ? AND desired_date = ? AND id != ?
       AND status IN ('confirmed','rescheduled') AND desired_time < ?
       AND strftime('%H:%M', desired_time, '+' || duration_minutes || ' minutes') > ? LIMIT 1`
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
    const reminderTarget: ReminderBooking = {
      id: body.id!, name: booking.name, phone: booking.phone, phoneNormalized: booking.phoneNormalized,
      patientEmail: booking.patientEmail, service: booking.service,
      desiredDate: body.desiredDate, desiredTime: body.desiredTime,
    };
    const reminder = await sendPatientReminder(db, "rescheduled", reminderTarget)
      .catch((error) => { console.error("reminder_failed", "rescheduled", body.id, error); return null; });
    return Response.json({ ok: true, status: "rescheduled", reminder });
  }

  if (body.confirm === true) {
    const booking = await db.prepare(
      `SELECT service_code AS serviceCode, equipment_id AS equipmentId, duration_minutes AS durationMinutes,
        desired_date AS desiredDate, desired_time AS desiredTime, status,
        name, phone, phone_normalized AS phoneNormalized, patient_email AS patientEmail, service
       FROM bookings WHERE id = ?`
    ).bind(body.id).first<{serviceCode:string;equipmentId:string;durationMinutes:number;desiredDate:string;desiredTime:string;status:string;name:string;phone:string;phoneNormalized:string;patientEmail:string;service:string}>();
    if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    if (booking.status === "cancelled" || booking.status === "completed") {
      return Response.json({ error: "Заявку вже закрито — підтвердження недоступне" }, { status: 400 });
    }
    const service = serviceByCode(booking.serviceCode);
    const cSched = parseSchedule(await getSetting(db, SCHEDULE_KEY));
    if (!service || !isBookableDate(booking.desiredDate) || !isEquipmentDayOpen(booking.desiredDate, cSched, service.equipmentId)
        || !candidateTimesFor(hoursFor(cSched, service.equipmentId), booking.durationMinutes).includes(booking.desiredTime)) {
      return Response.json({ error: "Бажаний час поза розкладом — перенесіть запис на вільний слот" }, { status: 400 });
    }
    const endTime = addMinutes(booking.desiredTime, booking.durationMinutes);
    const conflict = await db.prepare(
      `SELECT id FROM bookings WHERE equipment_id = ? AND desired_date = ? AND id != ?
       AND status IN ('confirmed','rescheduled') AND desired_time < ?
       AND strftime('%H:%M', desired_time, '+' || duration_minutes || ' minutes') > ? LIMIT 1`
    ).bind(booking.equipmentId, booking.desiredDate, body.id, endTime, booking.desiredTime).first();
    if (conflict) return Response.json({ error: "Цей час уже зайнятий — перенесіть запис на вільний слот" }, { status: 409 });
    const blocked = await db.prepare(
      `SELECT id FROM equipment_blocks WHERE equipment_id = ? AND blocked_date = ?
       AND start_time < ? AND end_time > ? LIMIT 1`
    ).bind(booking.equipmentId, booking.desiredDate, endTime, booking.desiredTime).first();
    if (blocked) return Response.json({ error: "Апарат недоступний у цей період — перенесіть запис" }, { status: 409 });
    await db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").bind(body.id).run();
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'status_changed', 'confirmed', ?)"
    ).bind(body.id, member.email).run();
    const reminderTarget: ReminderBooking = {
      id: body.id!, name: booking.name, phone: booking.phone, phoneNormalized: booking.phoneNormalized,
      patientEmail: booking.patientEmail, service: booking.service,
      desiredDate: booking.desiredDate, desiredTime: booking.desiredTime,
    };
    const reminder = await sendPatientReminder(db, "confirmed", reminderTarget)
      .catch((error) => { console.error("reminder_failed", "confirmed", body.id, error); return null; });
    return Response.json({ ok: true, status: "confirmed", reminder });
  }

  // Зміна статусу проходить через єдину state machine дослідження
  // (deny-by-default): цільовий стан має бути відомим і досяжним із поточного.
  if (!body.status || !isStudyState(body.status)) {
    return Response.json({ error: "Некоректний статус" }, { status: 400 });
  }
  const current = await db.prepare("SELECT status FROM bookings WHERE id = ?")
    .bind(body.id).first<{ status: string }>();
  if (!current) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  if (!canTransition(current.status, body.status)) {
    return Response.json(
      { error: `Перехід «${stateLabel(current.status)}» → «${stateLabel(body.status)}» недопустимий` },
      { status: 409 },
    );
  }
  await db.prepare("UPDATE bookings SET status = ? WHERE id = ?").bind(body.status, body.id).run();
  await db.prepare(
    "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'status_changed', ?, ?)"
  ).bind(body.id, body.status, member.email).run();
  return Response.json({ ok: true });
}
