import { createSession } from "../../../../lib/staff-auth";
import {
  hashPassword,
  isCompromisedPasswordHash,
  passwordHashNeedsUpgrade,
  sessionCookie,
  SESSION_TTL_SECONDS,
  verifyPassword,
} from "../../../../lib/auth";
import {
  clearIdentifierRateLimit,
  isIdentifierRateLimited,
  isRateLimited,
  recordIdentifierRateLimitFailure,
} from "../../../../lib/rate-limit";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

const STAFF_LOGIN_LIMIT = 10;
const STAFF_LOGIN_WINDOW_MINUTES = 15;

type TenantAccessState = {
  activeMembershipCount: number;
  membershipCount: number;
  activeOrgCount: number;
};

type AuditOrganizationRow = { organizationId: number };

async function authAuditOrganizationIds(
  db: D1Database,
  memberEmail: string | null,
  { activeOnly, allowSingleOrgFallback }: { activeOnly: boolean; allowSingleOrgFallback: boolean },
): Promise<number[]> {
  if (memberEmail) {
    const activeClause = activeOnly ? "AND m.active = 1 AND o.active = 1" : "";
    const linked = await db.prepare(
      `SELECT DISTINCT m.organization_id AS organizationId
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.member_email = ? ${activeClause}
       ORDER BY m.organization_id`
    ).bind(memberEmail).all<AuditOrganizationRow>();
    const ids = linked.results
      .map((row) => Number(row.organizationId))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length > 0) return ids;
  }

  // Unknown identifiers have no tenant identity. In a true single-org deployment
  // the sole active organization is the only meaningful audit owner; in multi-org
  // installations we deliberately avoid attributing the guess to an arbitrary
  // tenant. The same fallback supports the legacy empty-membership bootstrap.
  if (!allowSingleOrgFallback) return [];
  const activeOrganizations = await db.prepare(
    "SELECT id AS organizationId FROM organizations WHERE active = 1 ORDER BY id LIMIT 2"
  ).all<AuditOrganizationRow>();
  if (activeOrganizations.results.length !== 1) return [];
  const organizationId = Number(activeOrganizations.results[0]?.organizationId);
  return Number.isInteger(organizationId) && organizationId > 0 ? [organizationId] : [];
}

async function auditAuthEvent(
  db: D1Database,
  {
    memberEmail,
    actorEmail,
    action,
    details,
    activeOnly = false,
    allowSingleOrgFallback = false,
  }: {
    memberEmail: string | null;
    actorEmail: string;
    action: "login" | "login_failed";
    details: Record<string, unknown>;
    activeOnly?: boolean;
    allowSingleOrgFallback?: boolean;
  },
): Promise<void> {
  const organizationIds = await authAuditOrganizationIds(db, memberEmail, {
    activeOnly,
    allowSingleOrgFallback,
  });
  for (const organizationId of organizationIds) {
    await audit(db, {
      organizationId,
      actorEmail,
      action,
      resource: "auth",
      details,
    });
  }
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "staff-login", STAFF_LOGIN_LIMIT, STAFF_LOGIN_WINDOW_MINUTES)) {
    return Response.json({ error: "Забагато спроб входу. Спробуйте за 15 хвилин." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { phone?: string; email?: string; password?: string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  const password = String(body.password || "");
  if ((!phone && !email) || !password) {
    return Response.json({ error: "Вкажіть номер телефону і PIN-код" }, { status: 400 });
  }

  // Вхід за номером телефону (основний) або email (сумісність).
  const member = phone
    ? await db.prepare(
        "SELECT email, display_name AS displayName, role, password_hash AS passwordHash FROM staff_members WHERE phone = ? AND active = 1 LIMIT 1"
      ).bind(phone).first<{ email: string; displayName: string; role: string; passwordHash: string }>()
    : await db.prepare(
        "SELECT email, display_name AS displayName, role, password_hash AS passwordHash FROM staff_members WHERE email = ? AND active = 1 LIMIT 1"
      ).bind(email).first<{ email: string; displayName: string; role: string; passwordHash: string }>();

  // Known accounts are always throttled by one canonical account key, regardless
  // of whether the caller supplied phone or email. Unknown identifiers still get
  // their own hashed failure bucket, so raw phone/email values never reach
  // request_limits and repeated guesses for a nonexistent identifier are bounded.
  const submittedIdentifier = phone ? `phone:${phone}` : `email:${email}`;
  const accountIdentifier = member ? `account:${member.email.toLowerCase()}` : submittedIdentifier;
  if (await isIdentifierRateLimited(
    db,
    "staff-login-account",
    accountIdentifier,
    STAFF_LOGIN_LIMIT,
    STAFF_LOGIN_WINDOW_MINUTES,
  )) {
    return Response.json({ error: "Забагато спроб входу. Спробуйте за 15 хвилин." }, { status: 429 });
  }

  // Authentication is identity-level, but a session must only be issued when the
  // identity still has usable tenant access. Otherwise a user whose final
  // membership was disabled could immediately log in again and keep a fresh token
  // that would become usable if the membership were re-enabled before expiry.
  // Preserve the legacy bootstrap path only for a genuinely empty, single-org
  // installation, matching resolveOrgContext() exactly.
  const accessState = member
    ? await db.prepare(
        `SELECT
           (SELECT COUNT(*)
              FROM memberships m
              JOIN organizations o ON o.id = m.organization_id AND o.active = 1
             WHERE m.member_email = ? AND m.active = 1) AS activeMembershipCount,
           (SELECT COUNT(*) FROM memberships) AS membershipCount,
           (SELECT COUNT(*) FROM organizations WHERE active = 1) AS activeOrgCount`
      ).bind(member.email).first<TenantAccessState>()
    : null;
  const hasTenantAccess = Boolean(
    member && accessState && (
      Number(accessState.activeMembershipCount) > 0 ||
      (Number(accessState.membershipCount) === 0 && Number(accessState.activeOrgCount) === 1)
    )
  );

  const compromised = member ? isCompromisedPasswordHash(member.passwordHash) : false;
  // Always run PBKDF2 after the limiter. For unknown or deliberately blocked
  // accounts verifyPassword receives an empty hash and performs dummy KDF work,
  // removing the large timing difference that would reveal account existence.
  const ok = await verifyPassword(password, member && !compromised ? member.passwordHash : "");
  if (!member || !ok || !hasTenantAccess) {
    // A correct credential for a membership-disabled identity is an authorization
    // denial, not a credential failure, so it must not consume the account's
    // password-failure bucket. The response stays identical to prevent enumeration.
    if (!member || !ok) {
      await recordIdentifierRateLimitFailure(
        db,
        "staff-login-account",
        accountIdentifier,
        STAFF_LOGIN_LIMIT,
        STAFF_LOGIN_WINDOW_MINUTES,
      );
    }
    await auditAuthEvent(db, {
      memberEmail: member?.email || null,
      actorEmail: member?.email || phone || email || "невідомо",
      action: "login_failed",
      allowSingleOrgFallback: !member || Number(accessState?.membershipCount) === 0,
      details: {
        reason: compromised
          ? "compromised"
          : member && ok && !hasTenantAccess
            ? "no_active_membership"
            : member
              ? "wrong_password"
              : "unknown_account",
      },
    });
    return Response.json({ error: "Невірний номер телефону або PIN-код" }, { status: 401 });
  }

  await clearIdentifierRateLimit(db, "staff-login-account", accountIdentifier);

  if (passwordHashNeedsUpgrade(member.passwordHash)) {
    await db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
      .bind(await hashPassword(password), member.email).run();
  }

  await auditAuthEvent(db, {
    memberEmail: member.email,
    actorEmail: member.email,
    action: "login",
    activeOnly: true,
    allowSingleOrgFallback: Number(accessState?.membershipCount) === 0,
    details: { via: phone ? "phone" : "email" },
  });
  const rawToken = await createSession(db, member.email);
  return Response.json(
    { ok: true, staff: { email: member.email, displayName: member.displayName, role: member.role } },
    { headers: { "set-cookie": sessionCookie(rawToken, SESSION_TTL_SECONDS), "cache-control": "no-store" } },
  );
}
