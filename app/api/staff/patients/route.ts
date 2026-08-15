import { canManageBookings, canViewPatientRegistry } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { logSecurityEvent } from "../../../../lib/audit";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { dbBinding } from "../../../../lib/db";
import {
  PatientBookingRow,
  PatientProfile,
  buildExactPatientSummary,
  buildPatientSummaries,
  sanitizeCommunication,
  sanitizeProfile,
} from "../../../../lib/patients";

const BOOKING_COLUMNS = `id, code, name, phone_normalized AS phoneNormalized, patient_id AS patientId, service,
  service_code AS serviceCode, equipment_id AS equipmentId, desired_date AS desiredDate,
  desired_time AS desiredTime, status, patient_category AS patientCategory,
  marketing_source AS marketingSource, protocol_status AS protocolStatus,
  protocol_number AS protocolNumber, payment_status AS paymentStatus,
  payment_amount AS paymentAmount, paid_amount AS paidAmount,
  performed_at AS performedAt, created_at AS createdAt`;

const PROFILE_COLUMNS = `patient_id AS patientId, phone_normalized AS phoneNormalized, display_name AS displayName,
  birth_year AS birthYear, birth_date AS birthDate, email, address,
  tags, notes, do_not_contact AS doNotContact,
  updated_by AS updatedBy, updated_at AS updatedAt`;

const COMMUNICATION_COLUMNS = `id, patient_id AS patientId, phone_normalized AS phoneNormalized,
  channel, direction, summary, actor, created_at AS createdAt`;

const PATIENT_ID_RE = /^[0-9a-f]{32}$/;
type PatientProfileRow = PatientProfile & { patientId:string };

async function exactPatientData(db:D1Database, organizationId:number, patientId:string) {
  const profileRow = await db.prepare(
    `SELECT ${PROFILE_COLUMNS} FROM patient_profiles
     WHERE organization_id = ? AND patient_id = ? LIMIT 1`
  ).bind(organizationId, patientId).first<PatientProfileRow>();
  if (!profileRow) return null;

  const [bookings, communications] = await Promise.all([
    db.prepare(
      `SELECT ${BOOKING_COLUMNS} FROM bookings
       WHERE organization_id = ? AND patient_id = ?
       ORDER BY desired_date DESC, desired_time DESC`
    ).bind(organizationId, patientId).all(),
    db.prepare(
      `SELECT ${COMMUNICATION_COLUMNS} FROM patient_communications
       WHERE organization_id = ? AND patient_id = ?
       ORDER BY created_at DESC LIMIT 200`
    ).bind(organizationId, patientId).all(),
  ]);
  const rows = bookings.results as unknown as PatientBookingRow[];
  return {
    patient: buildExactPatientSummary(rows, profileRow),
    patientId,
    phone: profileRow.phoneNormalized,
    profile: profileRow,
    bookings: bookings.results,
    communications: communications.results,
    legacyCommunicationsExcluded: true,
  };
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const orgId = ctx.organizationId;
  if (!canViewPatientRegistry(member.role)) {
    return Response.json({ error: "Реєстр пацієнтів доступний лише реєстратору або адміністратору" }, { status: 403 });
  }

  const url = new URL(request.url);
  const rawPatientId = (url.searchParams.get("patientId") || "").trim().toLowerCase();
  if (rawPatientId) {
    if (!PATIENT_ID_RE.test(rawPatientId)) {
      return Response.json({ error: "Некоректний ідентифікатор пацієнта" }, { status: 400 });
    }
    const exact = await exactPatientData(db, orgId, rawPatientId);
    if (!exact) return Response.json({ error: "Пацієнта не знайдено" }, { status: 404 });
    await logSecurityEvent(db, {
      organizationId: orgId,
      actorEmail: member.email,
      action: "patient_record_viewed",
      resource: "patient",
      targetId: rawPatientId,
    });
    return Response.json({ ...exact, staff: member }, { headers: { "cache-control": "no-store" } });
  }

  // Legacy phone deep links remain usable only when the phone resolves safely.
  // Multiple profiles with one phone are deliberately ambiguous and must be
  // selected by immutable patient_id; never merge their clinical histories.
  const phone = normalizeUkrainianPhone(url.searchParams.get("phone") || "");
  if (phone) {
    const profileRows = await db.prepare(
      `SELECT ${PROFILE_COLUMNS} FROM patient_profiles
       WHERE organization_id = ? AND phone_normalized = ?
       ORDER BY updated_at DESC LIMIT 25`
    ).bind(orgId, phone).all();
    const profiles = profileRows.results as unknown as PatientProfileRow[];
    if (profiles.length > 1) {
      return Response.json({
        error: "Цей номер телефону використовується кількома пацієнтами. Оберіть конкретну картку.",
        ambiguous: true,
        matches: profiles.map((profile) => ({
          patientId: profile.patientId,
          displayName: profile.displayName,
          birthDate: profile.birthDate,
          phoneNormalized: profile.phoneNormalized,
        })),
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    if (profiles.length === 1) {
      const exact = await exactPatientData(db, orgId, profiles[0].patientId);
      if (!exact) return Response.json({ error: "Пацієнта не знайдено" }, { status: 404 });
      await logSecurityEvent(db, {
        organizationId: orgId,
        actorEmail: member.email,
        action: "patient_record_viewed",
        resource: "patient",
        targetId: profiles[0].patientId,
      });
      return Response.json({ ...exact, staff: member }, { headers: { "cache-control": "no-store" } });
    }

    const [bookings, communications] = await Promise.all([
      db.prepare(
        `SELECT ${BOOKING_COLUMNS} FROM bookings
         WHERE organization_id = ? AND phone_normalized = ? AND patient_id = ''
         ORDER BY desired_date DESC, desired_time DESC`
      ).bind(orgId, phone).all(),
      db.prepare(
        `SELECT ${COMMUNICATION_COLUMNS} FROM patient_communications
         WHERE organization_id = ? AND phone_normalized = ? AND patient_id = ''
         ORDER BY created_at DESC LIMIT 200`
      ).bind(orgId, phone).all(),
    ]);
    const rows = bookings.results as unknown as PatientBookingRow[];
    if (!rows.length) return Response.json({ error: "Пацієнта не знайдено" }, { status: 404 });
    const [summary] = buildPatientSummaries(rows, new Map());
    const auditTarget = rows[0]?.id ? `booking:${rows[0].id}` : "unlinked";
    await logSecurityEvent(db, {
      organizationId: orgId,
      actorEmail: member.email,
      action: "patient_record_viewed",
      resource: "patient",
      targetId: auditTarget,
    });
    return Response.json({
      patient: summary || null,
      patientId: "",
      phone,
      profile: null,
      bookings: bookings.results,
      communications: communications.results,
      staff: member,
    }, { headers: { "cache-control": "no-store" } });
  }

  const [bookings, profileRows] = await Promise.all([
    db.prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE phone_normalized != '' AND organization_id = ? LIMIT 3000`).bind(orgId).all(),
    db.prepare(`SELECT ${PROFILE_COLUMNS} FROM patient_profiles WHERE organization_id = ? ORDER BY updated_at DESC LIMIT 5000`).bind(orgId).all(),
  ]);
  const profiles = new Map<string, PatientProfile>();
  for (const row of profileRows.results as unknown as PatientProfileRow[]) profiles.set(row.patientId, row);
  const patients = buildPatientSummaries(bookings.results as unknown as PatientBookingRow[], profiles);
  await logSecurityEvent(db, {
    organizationId: orgId,
    actorEmail: member.email,
    action: "patient_registry_viewed",
    resource: "patient_registry",
    details: { rows: patients.length },
  });
  return Response.json({ patients, staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageBookings(member.role)) return Response.json({ error: "Картку пацієнта може змінювати лише реєстратор або адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = sanitizeProfile(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { profile } = parsed;
  const patientId = String(body.patientId || "").trim().toLowerCase();

  if (patientId) {
    if (!PATIENT_ID_RE.test(patientId)) {
      return Response.json({ error: "Некоректний ідентифікатор пацієнта" }, { status: 400 });
    }
    const updated = await db.prepare(
      `UPDATE patient_profiles SET
         phone_normalized = ?, display_name = ?, birth_year = ?, birth_date = ?,
         email = ?, address = ?, tags = ?, notes = ?, do_not_contact = ?,
         updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = ? AND patient_id = ?`
    ).bind(
      profile.phoneNormalized, profile.displayName, profile.birthYear, profile.birthDate,
      profile.email, profile.address, profile.tags, profile.notes, profile.doNotContact,
      member.email, ctx.organizationId, patientId,
    ).run();
    if (!updated.meta.changes) return Response.json({ error: "Пацієнта не знайдено" }, { status: 404 });
    const saved = await db.prepare(
      `SELECT ${PROFILE_COLUMNS} FROM patient_profiles WHERE organization_id = ? AND patient_id = ? LIMIT 1`
    ).bind(ctx.organizationId, patientId).first<PatientProfileRow>();
    if (!saved) return Response.json({ error: "Не вдалося зберегти картку пацієнта" }, { status: 500 });
    await logSecurityEvent(db, {
      organizationId: ctx.organizationId,
      actorEmail: member.email,
      action: "patient_profile_updated",
      resource: "patient",
      targetId: patientId,
    });
    return Response.json({ ok: true, profile: saved });
  }

  // Create is insert-only. Phone is intentionally not a conflict target: two
  // distinct patients may share it, and a mutable contact value must never
  // silently select an existing identity for overwrite.
  const newPatientId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  await db.prepare(
    `INSERT INTO patient_profiles
       (patient_id, organization_id, phone_normalized, display_name, birth_year, birth_date, email, address, tags, notes, do_not_contact, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    newPatientId, ctx.organizationId, profile.phoneNormalized, profile.displayName,
    profile.birthYear, profile.birthDate, profile.email, profile.address,
    profile.tags, profile.notes, profile.doNotContact, member.email,
  ).run();

  const saved = await db.prepare(
    `SELECT ${PROFILE_COLUMNS} FROM patient_profiles WHERE organization_id = ? AND patient_id = ? LIMIT 1`
  ).bind(ctx.organizationId, newPatientId).first<PatientProfileRow>();
  if (!saved) return Response.json({ error: "Не вдалося зберегти картку пацієнта" }, { status: 500 });
  await logSecurityEvent(db, {
    organizationId: ctx.organizationId,
    actorEmail: member.email,
    action: "patient_profile_created",
    resource: "patient",
    targetId: newPatientId,
  });
  return Response.json({ ok: true, profile: saved });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canViewPatientRegistry(member.role)) return Response.json({ error: "Комунікації доступні лише реєстратору або адміністратору" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const patientId = String(body.patientId || "").trim().toLowerCase();
  let exactPhone = "";
  if (patientId) {
    if (!PATIENT_ID_RE.test(patientId)) {
      return Response.json({ error: "Некоректний ідентифікатор пацієнта" }, { status: 400 });
    }
    const profile = await db.prepare(
      `SELECT phone_normalized AS phoneNormalized FROM patient_profiles
       WHERE organization_id = ? AND patient_id = ? LIMIT 1`
    ).bind(ctx.organizationId, patientId).first<{ phoneNormalized:string }>();
    if (!profile) return Response.json({ error: "Пацієнта не знайдено" }, { status: 404 });
    exactPhone = profile.phoneNormalized;
  }

  const parsed = sanitizeCommunication({ ...body, ...(exactPhone ? { phoneNormalized: exactPhone, phone: exactPhone } : {}) });
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { communication } = parsed;
  const inserted = await db.prepare(
    `INSERT INTO patient_communications
       (organization_id, patient_id, phone_normalized, channel, direction, summary, actor)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ctx.organizationId, patientId, communication.phoneNormalized,
    communication.channel, communication.direction, communication.summary, member.email,
  ).run();
  return Response.json({
    ok: true,
    communication: { id: inserted.meta.last_row_id, patientId, ...communication, actor: member.email },
  });
}
