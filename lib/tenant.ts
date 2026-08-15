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

// Only roles with a complete authorization contract are admitted to runtime.
// Future roles stay documented in ORG_ROLES but fail closed until their
// permissions are explicitly implemented and tested.
const ACTIVE_ACCESS_ROLES = new Set<AccessRole>([
  "admin",
  "organization_admin",
  "registrar",
  "radiologist",
  "radiographer",
]);

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

export async function requireOrgContext(request: Request, db: D1Database): Promise<OrgContext | null> {
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

  if (!ACTIVE_ACCESS_ROLES.has(row.role as AccessRole)) return null;
  const role = row.role as AccessRole;
  return {
    organizationId: row.organizationId,
    slug: row.slug,
    organizationName: row.organizationName,
    role,
    member: { email: identity.email, displayName: identity.displayName, role },
  };
}
