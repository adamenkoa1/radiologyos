// Серверний контекст організації (tenant).
//
// `organizationId` НІКОЛИ не приймається з тіла запиту чи параметрів клієнта —
// він виводиться виключно з перевіреної серверної сесії персоналу через
// членство (`memberships`). Це фундамент tenant-isolation.

import { requireStaff, type AccessRole, type StaffRole } from "./staff-auth";

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

const MEDICAL_OPERATIONAL_ROLES = new Set<AccessRole>([
  "admin",
  "registrar",
  "radiologist",
  "radiographer",
]);
const SYSTEM_ADMIN_ROLES = new Set<AccessRole>(["admin", "organization_admin"]);

export interface OrgMember {
  email: string;
  displayName: string;
  role: AccessRole;
}

export interface OrgContext {
  organizationId: number;
  slug: string;
  organizationName: string;
  role: AccessRole;
  member: OrgMember;
}

async function resolveOrgContext(
  request: Request,
  db: D1Database,
  allowedRoles: ReadonlySet<AccessRole>,
): Promise<OrgContext | null> {
  const identity = await requireStaff(request, db);
  if (!identity) return null;

  let row = await db.prepare(
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

  // Legacy bootstrap compatibility is allowed only for a genuinely empty
  // single-organization installation. Once any membership exists (or more than
  // one active organization exists), tenant access is explicit and deny-by-default.
  if (!row) {
    const bootstrap = await db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM memberships) AS membershipCount,
         (SELECT COUNT(*) FROM organizations WHERE active = 1) AS activeOrgCount`
    ).first<{ membershipCount: number; activeOrgCount: number }>();
    if (!bootstrap || Number(bootstrap.membershipCount) !== 0 || Number(bootstrap.activeOrgCount) !== 1) return null;
    if (!allowedRoles.has(identity.role)) return null;

    const org = await db.prepare(
      "SELECT id AS organizationId, slug, name AS organizationName FROM organizations WHERE active = 1 ORDER BY id ASC LIMIT 1"
    ).first<{ organizationId: number; slug: string; organizationName: string }>();
    if (!org) return null;
    await db.prepare(
      `INSERT INTO memberships (organization_id, member_email, role, active) VALUES (?, ?, ?, 1)
       ON CONFLICT(organization_id, member_email) DO UPDATE SET active = 1`
    ).bind(org.organizationId, identity.email, identity.role).run();
    row = { ...org, role: identity.role };
  }

  if (!allowedRoles.has(row.role as AccessRole)) return null;
  const role = row.role as AccessRole;
  return {
    organizationId: row.organizationId,
    slug: row.slug,
    organizationName: row.organizationName,
    role,
    member: { email: identity.email, displayName: identity.displayName, role },
  };
}

// Medical/operational context used by patient, booking, protocol, imaging and
// day-to-day workflow routes. System-only administrators are deliberately not
// admitted here, so legacy routes fail closed even if they contain role-specific
// assumptions of their own.
export function requireOrgContext(request: Request, db: D1Database): Promise<OrgContext | null> {
  return resolveOrgContext(request, db, MEDICAL_OPERATIONAL_ROLES);
}

// Dedicated control-plane context. A tenant-local `organization_admin` can
// manage accounts and integrations without becoming a medical-data authority.
// Legacy `admin` remains accepted for backwards compatibility.
export function requireSystemOrgContext(request: Request, db: D1Database): Promise<OrgContext | null> {
  return resolveOrgContext(request, db, SYSTEM_ADMIN_ROLES);
}
