// Tenant-aware репозиторій.
//
// Єдина точка доступу до бізнес-даних, прив'язаних до організації. КОЖЕН
// запит тут явно фільтрує `organization_id = ?` зі значенням із серверного
// контексту (`OrgContext.organizationId`) — так вибірка й мутація фізично не
// можуть дістати чужий tenant. Нові запити до бізнес-таблиць мають додаватися
// сюди, а не будуватися ad-hoc у роутах без фільтра організації.

import type { OrgContext } from "./tenant";

export interface OrgBookingRow {
  id: number;
  code: string;
  name: string;
  service: string;
  desiredDate: string;
  desiredTime: string;
  status: string;
}

// Записи організації за датою (найсвіжіші згори).
export async function listOrgBookings(db: D1Database, ctx: OrgContext, limit = 200): Promise<OrgBookingRow[]> {
  const result = await db.prepare(
    `SELECT id, code, name, service, desired_date AS desiredDate, desired_time AS desiredTime, status
     FROM bookings
     WHERE organization_id = ?
     ORDER BY desired_date DESC, desired_time DESC
     LIMIT ?`
  ).bind(ctx.organizationId, limit).all<OrgBookingRow>();
  return result.results ?? [];
}

// Один запис — лише якщо він належить організації контексту. Спроба відкрити
// чужий запис поверне null (isolation), а не рядок іншого tenant.
export async function getOrgBooking(db: D1Database, ctx: OrgContext, id: number): Promise<OrgBookingRow | null> {
  const row = await db.prepare(
    `SELECT id, code, name, service, desired_date AS desiredDate, desired_time AS desiredTime, status
     FROM bookings
     WHERE organization_id = ? AND id = ?
     LIMIT 1`
  ).bind(ctx.organizationId, id).first<OrgBookingRow>();
  return row ?? null;
}

export async function countOrgBookings(db: D1Database, ctx: OrgContext): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM bookings WHERE organization_id = ?"
  ).bind(ctx.organizationId).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface OrgStudyRow {
  id: number;
  code: string;
  name: string;
  service: string;
  equipmentId: string;
  desiredDate: string;
  desiredTime: string;
  status: string;
  performedAt: string;
  protocolStatus: string;
  studyStatus: string | null;
  accessionNumber: string | null;
  assignedRadiologistEmail: string;
  assignedRadiographerEmail: string;
}

// Реєстр досліджень: tenant scope застосовується завжди, а клінічні ролі
// додатково бачать лише записи, призначені саме їм. Admin/registrar можуть
// бачити всю чергу своєї організації для диспетчеризації та призначення.
export async function listOrgStudies(db: D1Database, ctx: OrgContext, limit = 500): Promise<OrgStudyRow[]> {
  const assignment = ctx.role === "radiologist"
    ? { sql: " AND b.assigned_radiologist_email = ?", binds: [ctx.member.email] }
    : ctx.role === "radiographer"
      ? { sql: " AND b.assigned_radiographer_email = ?", binds: [ctx.member.email] }
      : { sql: "", binds: [] as string[] };

  const result = await db.prepare(
    `SELECT b.id AS id, b.code AS code, b.name AS name, b.service AS service,
       b.equipment_id AS equipmentId, b.desired_date AS desiredDate, b.desired_time AS desiredTime,
       b.status AS status, b.performed_at AS performedAt, b.protocol_status AS protocolStatus,
       b.assigned_radiologist_email AS assignedRadiologistEmail,
       b.assigned_radiographer_email AS assignedRadiographerEmail,
       s.study_status AS studyStatus, s.accession_number AS accessionNumber
     FROM bookings b
     LEFT JOIN imaging_studies s ON s.booking_id = b.id AND s.organization_id = b.organization_id
     WHERE b.organization_id = ?${assignment.sql}
     ORDER BY b.desired_date DESC, b.desired_time DESC
     LIMIT ?`
  ).bind(ctx.organizationId, ...assignment.binds, limit).all<OrgStudyRow>();
  return result.results ?? [];
}

export interface OrgClinician {
  email: string;
  displayName: string;
  role: string;
}

// Виконавці для призначення — лише активні учасники цього tenant.
export async function listOrgClinicians(db: D1Database, ctx: OrgContext): Promise<OrgClinician[]> {
  const result = await db.prepare(
    `SELECT sm.email AS email, sm.display_name AS displayName, m.role AS role
     FROM memberships m
     JOIN staff_members sm ON sm.email = m.member_email AND sm.active = 1
     WHERE m.organization_id = ? AND m.active = 1
       AND m.role IN ('radiologist','radiographer')
     ORDER BY m.role, sm.display_name, sm.email`
  ).bind(ctx.organizationId).all<OrgClinician>();
  return result.results ?? [];
}

// Підрозділи (departments) організації контексту.
export async function listOrgDepartments(db: D1Database, ctx: OrgContext): Promise<Array<{ id: number; name: string; branchId: number }>> {
  const result = await db.prepare(
    `SELECT id, name, branch_id AS branchId
     FROM departments
     WHERE organization_id = ? AND active = 1
     ORDER BY id ASC`
  ).bind(ctx.organizationId).all<{ id: number; name: string; branchId: number }>();
  return result.results ?? [];
}
