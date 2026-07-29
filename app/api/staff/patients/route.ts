import { canManageBookings, canViewPatientRegistry, requireStaff } from "../../../../lib/staff-auth";
import { logSecurityEvent } from "../../../../lib/audit";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import {
  PatientBookingRow,
  PatientProfile,
  buildPatientSummaries,
  sanitizeCommunication,
  sanitizeProfile,
} from "../../../../lib/patients";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

const BOOKING_COLUMNS = `id, code, name, phone_normalized AS phoneNormalized, service,
  service_code AS serviceCode, equipment_id AS equipmentId, desired_date AS desiredDate,
  desired_time AS desiredTime, status, patient_category AS patientCategory,
  marketing_source AS marketingSource, protocol_status AS protocolStatus,
  protocol_number AS protocolNumber, payment_status AS paymentStatus,
  payment_amount AS paymentAmount, paid_amount AS paidAmount,
  performed_at AS performedAt, created_at AS createdAt`;

const PROFILE_COLUMNS = `phone_normalized AS phoneNormalized, display_name AS displayName,
  birth_year AS birthYear, tags, notes, do_not_contact AS doNotContact,
  updated_by AS updatedBy, updated_at AS updatedAt`;

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canViewPatientRegistry(member.role)) {
    return Response.json({ error: "Реєстр пацієнтів доступний лише реєстратору або адміністратору" }, { status: 403 });
  }

  const phone = normalizeUkrainianPhone(new URL(request.url).searchParams.get("phone") || "");

  if (phone) {
    const [bookings, profileRow, communications] = await Promise.all([
      db.prepare(
        `SELECT ${BOOKING_COLUMNS} FROM bookings
         WHERE organization_id = ? AND phone_normalized = ?
         ORDER BY desired_date DESC, desired_time DESC`
      ).bind(member.organizationId, phone).all(),
      db.prepare(
        `SELECT ${PROFILE_COLUMNS} FROM organization_patient_profiles
         WHERE organization_id = ? AND phone_normalized = ? LIMIT 1`
      ).bind(member.organizationId, phone).first<PatientProfile>(),
      db.prepare(
        `SELECT id, channel, direction, summary, actor, created_at AS createdAt
         FROM patient_communications
         WHERE organization_id = ? AND phone_normalized = ?
         ORDER BY created_at DESC LIMIT 200`
      ).bind(member.organizationId, phone).all(),
    ]);
    const rows = bookings.results as unknown as PatientBookingRow[];
    if (!rows.length && !profileRow) return Response.json({ error: "Пацієнта не знайдено" }, { status: 404 });
    const profiles = new Map<string, PatientProfile>();
    if (profileRow) profiles.set(phone, profileRow);
    const [summary] = buildPatientSummaries(rows, profiles);
    await logSecurityEvent(db, {
      actorEmail: member.email,
      organizationId: member.organizationId,
      action: "patient_record_viewed",
      resource: "patient",
      targetId: phone,
    });
    return Response.json({
      patient: summary || null,
      phone,
      profile: profileRow || null,
      bookings: bookings.results,
      communications: communications.results,
      staff: member,
    }, { headers: { "cache-control": "no-store" } });
  }

  const [bookings, profileRows] = await Promise.all([
    db.prepare(
      `SELECT ${BOOKING_COLUMNS} FROM bookings
       WHERE organization_id = ? AND phone_normalized != '' LIMIT 3000`
    ).bind(member.organizationId).all(),
    db.prepare(
      `SELECT ${PROFILE_COLUMNS} FROM organization_patient_profiles
       WHERE organization_id = ?`
    ).bind(member.organizationId).all(),
  ]);
  const profiles = new Map<string, PatientProfile>();
  for (const row of profileRows.results as unknown as PatientProfile[]) profiles.set(row.phoneNormalized, row);
  const patients = buildPatientSummaries(bookings.results as unknown as PatientBookingRow[], profiles);
  await logSecurityEvent(db, {
    actorEmail: member.email,
    organizationId: member.organizationId,
    action: "patient_registry_viewed",
    resource: "patient_registry",
    details: { rows: patients.length },
  });
  return Response.json({ patients, staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageBookings(member.role)) {
    return Response.json({ error: "Картку пацієнта може змінювати лише реєстратор або адміністратор" }, { status: 403 });
  }
  const parsed = sanitizeProfile(await request.json());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { profile } = parsed;

  await db.prepare(
    `INSERT INTO organization_patient_profiles
       (organization_id, phone_normalized, display_name, birth_year, tags, notes,
        do_not_contact, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id, phone_normalized) DO UPDATE SET
       display_name = excluded.display_name, birth_year = excluded.birth_year,
       tags = excluded.tags, notes = excluded.notes, do_not_contact = excluded.do_not_contact,
       updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
  ).bind(
    member.organizationId,
    profile.phoneNormalized, profile.displayName, profile.birthYear,
    profile.tags, profile.notes, profile.doNotContact, member.email,
  ).run();

  return Response.json({ ok: true, profile: { ...profile, updatedBy: member.email } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canViewPatientRegistry(member.role)) {
    return Response.json({ error: "Комунікації доступні лише реєстратору або адміністратору" }, { status: 403 });
  }
  const parsed = sanitizeCommunication(await request.json());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { communication } = parsed;

  const inserted = await db.prepare(
    `INSERT INTO patient_communications
      (organization_id, phone_normalized, channel, direction, summary, actor)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    member.organizationId,
    communication.phoneNormalized,
    communication.channel,
    communication.direction,
    communication.summary,
    member.email,
  ).run();

  return Response.json({
    ok: true,
    communication: {
      id: inserted.meta.last_row_id,
      ...communication,
      actor: member.email,
    },
  });
}
