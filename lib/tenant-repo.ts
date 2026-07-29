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
