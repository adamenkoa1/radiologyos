import { hashToken, newSessionToken, readCookie } from "./auth";
import { DEFAULT_ORGANIZATION_ID } from "./tenant";

export const PATIENT_SESSION_COOKIE = "rid_patient";
export const PATIENT_SESSION_TTL_SECONDS = 30 * 60;

export function normalizeBookingCode(value: unknown): string {
  const code = String(value || "").trim().toUpperCase().slice(0, 24);
  return /^RD-[A-Z0-9]{8,16}$/.test(code) ? code : "";
}

export async function createPatientSession(
  db: D1Database,
  phoneNormalized: string,
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<string> {
  const rawToken = newSessionToken();
  const tokenHash = await hashToken(rawToken);
  await db.prepare(
    `INSERT INTO patient_sessions
      (token_hash, organization_id, phone_normalized, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`
  ).bind(
    tokenHash,
    organizationId,
    phoneNormalized,
    `+${PATIENT_SESSION_TTL_SECONDS} seconds`,
  ).run();
  await db.prepare("DELETE FROM patient_sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
  return rawToken;
}

export async function requirePatientSession(request: Request, db: D1Database) {
  const rawToken = readCookie(request, PATIENT_SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await hashToken(rawToken);
  return db.prepare(
    `SELECT organization_id AS organizationId, phone_normalized AS phoneNormalized
     FROM patient_sessions
     WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`
  ).bind(tokenHash).first<{ organizationId: string; phoneNormalized: string }>();
}

export async function destroyPatientSession(request: Request, db: D1Database): Promise<void> {
  const rawToken = readCookie(request, PATIENT_SESSION_COOKIE);
  if (!rawToken) return;
  await db.prepare("DELETE FROM patient_sessions WHERE token_hash = ?")
    .bind(await hashToken(rawToken)).run();
}

export function patientSessionCookie(rawToken: string, maxAgeSeconds = PATIENT_SESSION_TTL_SECONDS): string {
  return `${PATIENT_SESSION_COOKIE}=${rawToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearedPatientSessionCookie(): string {
  return `${PATIENT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
