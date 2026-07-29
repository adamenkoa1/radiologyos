import { SESSION_TTL_SECONDS, hashToken, newSessionToken, readCookie, SESSION_COOKIE } from "./auth";
import {
  DEFAULT_DEPARTMENT_ID,
  DEFAULT_ORGANIZATION_ID,
  normalizeOrganizationId,
} from "./tenant";

export type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
export interface StaffIdentity {
  email: string;
  displayName: string;
  role: StaffRole;
  organizationId: string;
  departmentId: string;
}

// Resolve the signed-in staff member from the session cookie. Returns null for
// anonymous or expired sessions.
export async function requireStaff(request: Request, db: D1Database) {
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await hashToken(rawToken);
  const member = await db.prepare(
    `SELECT m.email AS email, m.display_name AS displayName, om.role AS role,
      s.organization_id AS organizationId, s.department_id AS departmentId
     FROM staff_sessions s
     JOIN staff_members m ON m.email = s.email AND m.active = 1
     JOIN organization_memberships om
       ON om.organization_id = s.organization_id
      AND om.staff_email = s.email
      AND om.active = 1
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`
  ).bind(tokenHash).first<StaffIdentity>();
  return member || null;
}

// Issue a new session for an authenticated member and return the raw token to
// place in the cookie. Old sessions for the member are pruned opportunistically.
export async function createSession(
  db: D1Database,
  email: string,
  organizationId = DEFAULT_ORGANIZATION_ID,
  departmentId = DEFAULT_DEPARTMENT_ID,
): Promise<string> {
  const rawToken = newSessionToken();
  const tokenHash = await hashToken(rawToken);
  await db.prepare(
    `INSERT INTO staff_sessions
      (token_hash, email, organization_id, department_id, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`
  ).bind(
    tokenHash,
    email,
    normalizeOrganizationId(organizationId),
    departmentId,
    `+${SESSION_TTL_SECONDS} seconds`,
  ).run();
  await db.prepare("DELETE FROM staff_sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
  return rawToken;
}

export async function destroySession(db: D1Database, rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = await hashToken(rawToken);
  await db.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export function canManageBookings(role: StaffRole) {
  return role === "admin" || role === "registrar";
}

export function canWriteNotes(role: StaffRole) {
  return role === "admin" || role === "registrar" || role === "radiologist" || role === "radiographer";
}

export function canManageProtocols(role: StaffRole) {
  return role === "admin" || role === "radiologist";
}

export function canManageFinance(role: StaffRole) {
  return role === "admin" || role === "registrar";
}

export function canManageImaging(role: StaffRole) {
  return role === "admin" || role === "radiographer" || role === "radiologist";
}

export function canViewPatientRegistry(role: StaffRole) {
  return role === "admin" || role === "registrar";
}

export function canExportPatientData(role: StaffRole) {
  return role === "admin";
}

export function canViewReports(role: StaffRole) {
  return role === "admin";
}

export function canAccessAllBookings(role: StaffRole) {
  return role === "admin" || role === "registrar";
}

export async function canAccessBooking(
  db: D1Database,
  member: Pick<StaffIdentity, "email" | "role" | "organizationId">,
  bookingId: number,
): Promise<boolean> {
  const assignment = canAccessAllBookings(member.role)
    ? "1 = 1"
    : member.role === "radiologist"
      ? "assigned_radiologist_email = ?"
      : "assigned_radiographer_email = ?";
  const values = canAccessAllBookings(member.role)
    ? [bookingId, member.organizationId]
    : [bookingId, member.organizationId, member.email];
  const row = await db.prepare(
    `SELECT id FROM bookings
     WHERE id = ? AND organization_id = ? AND ${assignment}
     LIMIT 1`
  ).bind(...values).first();
  return Boolean(row);
}
