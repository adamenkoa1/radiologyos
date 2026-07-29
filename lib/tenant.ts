// Серверний контекст організації (tenant).
//
// `organizationId` НІКОЛИ не приймається з тіла запиту чи параметрів клієнта —
// він виводиться виключно з перевіреної серверної сесії персоналу через
// членство (`memberships`). Це фундамент tenant-isolation: кожна вибірка й
// мутація бізнес-даних має обмежуватися організацією з цього контексту.

import { requireStaff, type StaffRole } from "./staff-auth";

// Канонічний перелік ролей платформи (розширюється еволюційно). Поточні
// облікові записи персоналу використовують підмножину; deny-by-default —
// невідома роль не отримує жодних прав.
export const ORG_ROLES = [
  "platform_owner",
  "organization_admin",
  "department_head",
  "registrar",
  "radiologist",
  "radiographer",
  "cashier",
  "auditor",
] as const;

export type OrgRole = (typeof ORG_ROLES)[number] | StaffRole;

export interface OrgMember {
  email: string;
  displayName: string;
  role: StaffRole;
}

export interface OrgContext {
  organizationId: number;
  slug: string;
  organizationName: string;
  role: OrgRole;
  member: OrgMember;
}

// Розв'язує організацію активного співробітника. Повертає null, якщо сесія
// анонімна/протермінована або співробітник не є учасником жодної активної
// організації. Пріоритет — початковий tenant (найменший organization_id).
export async function requireOrgContext(request: Request, db: D1Database): Promise<OrgContext | null> {
  const member = await requireStaff(request, db);
  if (!member) return null;

  const row = await db.prepare(
    `SELECT o.id AS organizationId, o.slug AS slug, o.name AS organizationName, m.role AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id AND o.active = 1
     WHERE m.member_email = ? AND m.active = 1
     ORDER BY o.id ASC
     LIMIT 1`
  ).bind(member.email).first<{
    organizationId: number;
    slug: string;
    organizationName: string;
    role: string;
  }>();
  if (!row) return null;

  return {
    organizationId: row.organizationId,
    slug: row.slug,
    organizationName: row.organizationName,
    role: (row.role as OrgRole) || member.role,
    member,
  };
}
