import { destroySession, requireStaff } from "../../../../lib/staff-auth";
import { clearedSessionCookie, readCookie, SESSION_COOKIE } from "../../../../lib/auth";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

type AuditOrganizationRow = { organizationId: number };

async function logoutAuditOrganizationIds(db: D1Database, memberEmail: string): Promise<number[]> {
  const linked = await db.prepare(
    `SELECT DISTINCT m.organization_id AS organizationId
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.member_email = ? AND m.active = 1 AND o.active = 1
     ORDER BY m.organization_id`
  ).bind(memberEmail).all<AuditOrganizationRow>();
  const ids = linked.results
    .map((row) => Number(row.organizationId))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length > 0) return ids;

  // The only safe fallback is the legacy bootstrap state where memberships have
  // never been created at all. A detached or disabled identity must not be
  // attributed to an arbitrary organization merely because one active tenant
  // happens to remain.
  const membershipCount = await db.prepare("SELECT COUNT(*) AS n FROM memberships").first<{ n: number }>();
  if (Number(membershipCount?.n || 0) !== 0) return [];

  const activeOrganizations = await db.prepare(
    "SELECT id AS organizationId FROM organizations WHERE active = 1 ORDER BY id LIMIT 2"
  ).all<AuditOrganizationRow>();
  if (activeOrganizations.results.length !== 1) return [];
  const organizationId = Number(activeOrganizations.results[0]?.organizationId);
  return Number.isInteger(organizationId) && organizationId > 0 ? [organizationId] : [];
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (db) {
    // Resolve the identity before destroying its global session. Logout invalidates
    // that identity-level token for every tenant it could enter, so each active
    // membership receives its own tenant-scoped security event.
    const member = await requireStaff(request, db).catch(() => null);
    if (member) {
      for (const organizationId of await logoutAuditOrganizationIds(db, member.email)) {
        await audit(db, {
          organizationId,
          actorEmail: member.email,
          action: "logout",
          resource: "auth",
        });
      }
    }
    await destroySession(db, readCookie(request, SESSION_COOKIE));
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie(), "cache-control": "no-store" } });
}