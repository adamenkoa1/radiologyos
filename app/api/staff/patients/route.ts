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

type PatientProfileRow = PatientProfile & { patientId:string };

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
    if (!/^[0-9a-f]{32}$/.test(rawPatientId)) {
      return Response.json({ error: "Некоректний ідентифікатор пацієнта" }, { status: 400 });
    }
    const profileRow = await db.prepare(
      `SELECT ${PROFILE_COLUMNS} FROM patient_profiles
       WHERE organization_id = ? AND patient_id = ? LIMIT 1`
    ).bind(orgId, rawPatientId).first<PatientProfileRow>();
    if (!profileRow) return Response.json({ error: "Пацієнта не знайдено" }, { status: 404 });

    const [bookings, communications] = await Promise.all([
      db.prepare(
        `SELECT ${BOOKING_COLUMNS} FROM bookings
         WHERE organization_id = ? AND patient_id = ?
         ORDER BY desired_date DESC, desired_time DESC`
      ).bind(orgId, rawPatientId).all(),
      db.prepare(
        `SELECT ${COMMUNICATION_COLUMNS} FROM patient_communications
         WHERE organization_id = ? AND patient_id = ?
         ORDER BY created_at DESC LIMIT 200`
      ).bind(orgId, rawPatientId).all(),
    ]);
    const rows = bookings.results as unknown as PatientBookingRow[];
    const summary = buildExactPatientSummary(rows, profileRow);
    await logSecurityEvent(db, {
      organizationId: orgId,
      actorEmail: member.email,
      action: "patient_record_viewed",
      resource: "patient",
      targetId: rawPatientId,
    });
    return Response.json({
      patient: summary,
      patientId: rawPatientId,
      phone: profileRow.phoneNormalized,
      profile: profileRow,
      bookings: bookings.results,
      communications: communications.results,
      legacyCommunicationsExcluded: true,
      staff: member,
    }, { headers: { "cache-control": "no-store" } });
  }

  const phone = normalizeUkrainianPhone(url.searchParams.get("phone") || "");
  if (phone) {
    const [bookings, profileRow, communications] = await Promise.all([
      db.prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE phone_normalized = ? AND organization_id = ? ORDER BY desired_date DESC, desired_time DESC`).bind(phone, orgId).all(),
      db.prepare(`SELECT ${PROFILE_COLUMNS} FROM patient_profiles WHERE phone_normalized = ? AND organization_id = ? LIMIT 1`).bind(phone, orgId).first<PatientProfileRow>(),
      db.prepare(`SELECT ${COMMUNICATION_COLUMNS}
         FROM patient_communications WHERE phone_normalized = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 200`).bind(phone, orgId).all(),
    ]);
    const rows = bookings.results as unknown as PatientBookingRow[];
    if (!rows.length && !profileRow) return Response.json({ error: "Пацієнта не знайдено" }, { status: 404 });
    const profiles = new Map<string, PatientProfile>();
    if (profileRow) profiles.set(phone, profileRow);
    const [summary] = buildPatientSummaries(rows, profiles);
    const auditTarget = profileRow?.patientId || (rows[0]?.id ? `booking:${rows[0].id}` : "unlinked");
    await logSecurityEvent(db, { organizationId: orgId, actorEmail: member.email, action: "patient_record_viewed", resource: "patient", targetId: auditTarget });
    return Response.json({ patient: summary || null, phone, profile: profileRow || null, bookings: bookings.results, communications: communications.results, staff: member }, { headers: { "cache-control": "no-store" } });
  }

  const [bookings, profileRows] = await Promise.all([
    db.prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE phone_normalized != '' AND organization_id = ? LIMIT 3000`).bind(orgId).all(),
    db.prepare(`SELECT ${PROFILE_COLUMNS} FROM patient_profiles WHERE organization_id = ? ORDER BY updated_at DESC LIMIT 5000`).bind(orgId).all(),
  ]);
  const profiles = new Map<string, PatientProfile>();
  for (const row of profileRows.results as unknown as PatientProfileRow[]) profiles.set(row.phoneNormalized, row);
  const patients = buildPatientSummaries(bookings.results as unknown as PatientBookingRow[], profiles);
  await logSecurityEvent(db, { organizationId: orgId, actorEmail: member.email, action: "patient_registry_viewed", resource: "patient_registry", details: { rows: patients.length } });
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
    if (!/^[0-9a-f]{32}$/.test(patientId)) {
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
    return Response.json({ ok: true, profile: saved });
  }

  await db.prepare(
    `INSERT INTO patient_profiles
       (organization_id, phone_normalized, display_name, birth_year, birth_date, email, address, tags, notes, do_not_contact, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id, phone_normalized) DO UPDATE SET
       display_name = excluded.display_name, birth_year = excluded.birth_year,
       birth_date = excluded.birth_date, email = excluded.email, address = excluded.address,
       tags = excluded.tags, notes = excluded.notes, do_not_contact = excluded.do_not_contact,
       updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
  ).bind(ctx.organizationId, profile.phoneNormalized, profile.displayName, profile.birthYear, profile.birthDate, profile.email, profile.address, profile.tags, profile.notes, profile.doNotContact, member.email).run();

  const saved = await db.prepare(
    `SELECT ${PROFILE_COLUMNS} FROM patient_profiles WHERE organization_id = ? AND phone_normalized = ? LIMIT 1`
  ).bind(ctx.organizationId, profile.phoneNormalized).first<PatientProfileRow>();
  if (!saved) return Response.json({ error: "Не вдалося зберегти картку пацієнта" }, { status: 500 });
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
    if (!/^[0-9a-f]{32}$/.test(patientId)) {
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
