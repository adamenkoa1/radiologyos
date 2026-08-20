// Серверний контекст організації (tenant).
//
// `organizationId` НІКОЛИ не приймається з тіла запиту чи параметрів клієнта —
// він виводиться виключно з перевіреної серверної сесії персоналу через
// членство (`memberships`). Це фундамент tenant-isolation.

import { requireStaff, type AccessRole, type ManagementRole, type StaffRole, type SystemRole } from "./staff-auth";

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

const MEDICAL_OPERATIONAL_ROLES = new Set<StaffRole>([
  "admin",
  "registrar",
  "radiologist",
  "radiographer",
]);
const SYSTEM_ADMIN_ROLES = new Set<SystemRole>(["admin", "organization_admin"]);
const MANAGEMENT_ROLES = new Set<ManagementRole>(["admin", "department_head"]);
const SELF_SERVICE_ROLES = new Set<AccessRole>([
  "admin",
  "organization_admin",
  "department_head",
  "registrar",
  "radiologist",
  "radiographer",
]);

export interface OrgMember<R extends AccessRole = StaffRole> {
  email: string;
  displayName: string;
  role: R;
}

export interface OrgContext<R extends AccessRole = StaffRole> {
  organizationId: number;
  slug: string;
  organizationName: string;
  role: R;
  member: OrgMember<R>;
}

type MembershipContextRow = {
  organizationId: number;
  slug: string;
  organizationName: string;
  role: string;
};

async function resolveOrgContext<R extends AccessRole>(
  request: Request,
  db: D1Database,
  allowedRoles: ReadonlySet<R>,
): Promise<OrgContext<R> | null> {
  const identity = await requireStaff(request, db);
  if (!identity) return null;

  // One identity may belong to several organizations with different roles. Resolve
  // the tenant only from server-verified active memberships whose role is valid for
  // this capability context. Selecting the first tenant before checking its role
  // would incorrectly deny a legitimate org2 radiologist merely because org1 has
  // a management-only membership for the same identity.
  const memberships = await db.prepare(
    `SELECT o.id AS organizationId, o.slug AS slug, o.name AS organizationName, m.role AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id AND o.active = 1
     WHERE m.member_email = ? AND m.active = 1
     ORDER BY o.id ASC`
  ).bind(identity.email).all<MembershipContextRow>();
  let row = memberships.results.find((candidate) => allowedRoles.has(candidate.role as R)) || null;

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
    if (!allowedRoles.has(identity.role as R)) return null;

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

  if (!allowedRoles.has(row.role as R)) return null;
  const role = row.role as R;
  return {
    organizationId: row.organizationId,
    slug: row.slug,
    organizationName: row.organizationName,
    role,
    member: { email: identity.email, displayName: identity.displayName, role },
  };
}

// Medical/operational context used by patient, booking, protocol, imaging and
// day-to-day workflow routes. System-only administrators and management-only
// roles are deliberately not admitted here.
export function requireOrgContext(request: Request, db: D1Database): Promise<OrgContext<StaffRole> | null> {
  return resolveOrgContext(request, db, MEDICAL_OPERATIONAL_ROLES);
}

// Dedicated control-plane context. A tenant-local `organization_admin` can
// manage accounts and integrations without becoming a medical-data authority.
// Legacy `admin` remains accepted for backwards compatibility.
export function requireSystemOrgContext(request: Request, db: D1Database): Promise<OrgContext<SystemRole> | null> {
  return resolveOrgContext(request, db, SYSTEM_ADMIN_ROLES);
}

// Dedicated management context. `department_head` can read aggregate operational
// state but is kept outside both medical/operational and system-admin contexts.
export function requireManagementOrgContext(request: Request, db: D1Database): Promise<OrgContext<ManagementRole> | null> {
  return resolveOrgContext(request, db, MANAGEMENT_ROLES);
}

// Neutral self-service identity context. It is intentionally capability-free:
// it exists only for a user to read/update their own account profile and does
// not grant access to medical, management, or system-admin resources.
export function requireSelfServiceOrgContext(request: Request, db: D1Database): Promise<OrgContext<AccessRole> | null> {
  return resolveOrgContext(request, db, SELF_SERVICE_ROLES);
}
