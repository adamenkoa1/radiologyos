// Серверний контекст організації (tenant).
//
// `organizationId` НІКОЛИ не приймається з тіла запиту чи параметрів клієнта —
// він виводиться виключно з перевіреної серверної сесії персоналу через
// активне членство (`memberships`). Це фундамент tenant-isolation.

import { requireStaff, type StaffRole } from "./staff-auth";

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

const ACTIVE_STAFF_ROLES = new Set<StaffRole>(["admin", "registrar", "radiologist", "radiographer"]);

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

// Розв'язує організацію активного співробітника. Membership є єдиним джерелом
// tenant-доступу та tenant-ролі. Відсутність membership завжди означає deny:
// автоматичне приєднання до першої організації було небезпечним, бо дозволяло
// глобальному staff-акаунту самостійно отримати доступ до tenant.
export async function requireOrgContext(request: Request, db: D1Database): Promise<OrgContext | null> {
  const identity = await requireStaff(request, db);
  if (!identity) return null;

  const row = await db.prepare(
    `SELECT o.id AS organizationId, o.slug AS slug, o.name AS organizationName, m.role AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id AND o.active = 1
     WHERE m.member_email = ? AND m.active = 1
     ORDER BY o.id ASC
     LIMIT 1`
  ).bind(identity.email).first<{
    organizationId: number;
    slug: string;
    organizationName: string;
    role: string;
  }>();
  if (!row) return null;

  // Розширені platform/org ролі ще не підключені до чинної StaffRole RBAC.
  // До їх явної реалізації — deny-by-default, а не fallback до глобальної ролі
  // `staff_members.role`, яка не може бути джерелом tenant-привілеїв.
  if (!ACTIVE_STAFF_ROLES.has(row.role as StaffRole)) return null;
  const role = row.role as StaffRole;

  return {
    organizationId: row.organizationId,
    slug: row.slug,
    organizationName: row.organizationName,
    role,
    member: { email: identity.email, displayName: identity.displayName, role },
  };
}
