import { SESSION_TTL_SECONDS, hashToken, newSessionToken, readCookie, SESSION_COOKIE } from "./auth";

// `staff_members.role` remains a legacy identity/bootstrap role so existing
// installations keep working. Tenant authorization is derived from
// `memberships.role` and may use a narrower organization-only role.
export type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
export type SystemRole = "admin" | "organization_admin";
export type ManagementRole = "admin" | "department_head";
export type AccessRole = StaffRole | SystemRole | ManagementRole;

// Resolve the signed-in staff member from the session cookie. Returns null for
// anonymous or expired sessions.
export async function requireStaff(request: Request, db: D1Database) {
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await hashToken(rawToken);
  const member = await db.prepare(
    `SELECT m.email AS email, m.display_name AS displayName, m.role AS role
     FROM staff_sessions s
     JOIN staff_members m ON m.email = s.email AND m.active = 1
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`
  ).bind(tokenHash).first<{email:string;displayName:string;role:StaffRole}>();
  return member || null;
}

// Issue a new session for an authenticated member and return the raw token to
// place in the cookie. Old sessions for the member are pruned opportunistically.
export async function createSession(db: D1Database, email: string): Promise<string> {
  const rawToken = newSessionToken();
  const tokenHash = await hashToken(rawToken);
  await db.prepare(
    `INSERT INTO staff_sessions (token_hash, email, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  ).bind(tokenHash, email, `+${SESSION_TTL_SECONDS} seconds`).run();
  await db.prepare("DELETE FROM staff_sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
  return rawToken;
}

export async function destroySession(db: D1Database, rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = await hashToken(rawToken);
  await db.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").bind(tokenHash).run();
}

// Control-plane authority. Legacy `admin` intentionally keeps all existing
// powers for backwards compatibility; new `organization_admin` is the system
// administrator and does not inherit medical-data access from this helper.
export function canManageSystem(role: AccessRole) {
  return role === "admin" || role === "organization_admin";
}

// Read-only management authority. `department_head` is intentionally separate
// from clinical and system-administration capabilities: it may inspect aggregate
// operational state without inheriting access to patient-level records.
export function canViewManagementSummary(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

export function canManageBookings(role: AccessRole) {
  return role === "admin" || role === "registrar";
}

export function canWriteNotes(role: AccessRole) {
  return role === "admin" || role === "registrar" || role === "radiologist" || role === "radiographer";
}

export function canManageProtocols(role: AccessRole) {
  return role === "admin" || role === "radiologist";
}

// A clinical signature must identify an actual radiologist membership. Legacy
// `admin` remains able to prepare and issue documents for compatibility, but is
// deliberately not treated as a clinical signer.
export function canSignProtocols(role: AccessRole) {
  return role === "radiologist";
}

export function canManageFinance(role: AccessRole) {
  return role === "admin" || role === "registrar";
}

export function canManageImaging(role: AccessRole) {
  return role === "admin" || role === "radiographer" || role === "radiologist";
}

export function canViewPatientRegistry(role: AccessRole) {
  return role === "admin" || role === "registrar";
}

export function canExportPatientData(role: AccessRole) {
  return role === "admin";
}

export function canViewReports(role: AccessRole) {
  return role === "admin";
}

export function canAccessAllBookings(role: AccessRole) {
  return role === "admin" || role === "registrar";
}

// Доступ до заявки завжди перевіряється всередині конкретної організації.
// Tenant scope є обов'язковою частиною security primitive: навіть admin або
// registrar не можуть викликати helper у режимі "усі організації".
export async function canAccessBooking(
  db: D1Database,
  member: { email: string; role: AccessRole },
  bookingId: number,
  organizationId: number,
): Promise<boolean> {
  if (!Number.isInteger(bookingId) || bookingId <= 0) return false;
  if (!Number.isInteger(organizationId) || organizationId <= 0) return false;

  if (canAccessAllBookings(member.role)) {
    const row = await db.prepare(
      "SELECT id FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1"
    ).bind(bookingId, organizationId).first();
    return Boolean(row);
  }

  const column = member.role === "radiologist"
    ? "assigned_radiologist_email"
    : member.role === "radiographer"
      ? "assigned_radiographer_email"
      : "";
  // Non-clinical roles fail closed instead of falling through to a clinician
  // assignment column. This is essential before activating new membership roles.
  if (!column) return false;
  const row = await db.prepare(
    `SELECT id FROM bookings WHERE id = ? AND ${column} = ? AND organization_id = ? LIMIT 1`
  ).bind(bookingId, member.email, organizationId).first();
  return Boolean(row);
}
