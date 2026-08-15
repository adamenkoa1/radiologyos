import {
  hashPassword,
  hashToken,
  newSessionToken,
  readCookie,
  verifyPassword,
} from "./auth.ts";

export const PATIENT_SESSION_COOKIE = "rid_patient";
export const PATIENT_SESSION_TTL_SECONDS = 30 * 60;
export const PATIENT_OTP_TTL_SECONDS = 5 * 60;
export const PATIENT_OTP_MAX_ATTEMPTS = 5;

export type PatientIdentityScope = {
  kind: "dob" | "booking";
  value: string;
};

export function normalizeBookingCode(value: unknown): string {
  const code = String(value || "").trim().toUpperCase().slice(0, 24);
  // Новий формат RD-РРММДД-N (дата + добовий номер) та легасі RD-<hex16>.
  return /^RD-(?:[A-Z0-9]{8,16}|\d{6}-\d{1,4})$/.test(code) ? code : "";
}

export function normalizeOtp(value: unknown): string {
  const code = String(value || "").trim();
  return /^\d{6}$/.test(code) ? code : "";
}

function newOtpCode(): string {
  // Rejection sampling avoids modulo bias while keeping a simple six-digit OTP.
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  let value = 0;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= limit);
  return String(value % 1_000_000).padStart(6, "0");
}

export async function createPatientOtpChallenge(
  db: D1Database,
  phoneNormalized: string,
  organizationId: number,
  identity: PatientIdentityScope,
  purpose = "cabinet_login",
  patientId = "",
): Promise<{ challengeId: string; code: string; expiresIn: number }> {
  const challengeId = newSessionToken();
  const code = newOtpCode();
  const codeHash = await hashPassword(code);

  // Only the newest challenge for the same proven identity remains usable.
  // Separate family members may share a phone number without invalidating each
  // other's challenge as long as their DOB/booking proof differs.
  await db.batch([
    db.prepare(
      `UPDATE patient_otp_challenges SET consumed_at = CURRENT_TIMESTAMP
       WHERE organization_id = ? AND phone_normalized = ?
         AND identity_kind = ? AND identity_value = ? AND purpose = ?
         AND consumed_at = '' AND expires_at > CURRENT_TIMESTAMP`,
    ).bind(organizationId, phoneNormalized, identity.kind, identity.value, purpose),
    db.prepare(
      `INSERT INTO patient_otp_challenges
       (id, organization_id, phone_normalized, identity_kind, identity_value,
        patient_id, purpose, code_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
    ).bind(
      challengeId,
      organizationId,
      phoneNormalized,
      identity.kind,
      identity.value,
      patientId,
      purpose.slice(0, 40),
      codeHash,
      `+${PATIENT_OTP_TTL_SECONDS} seconds`,
    ),
  ]);

  // Opportunistic cleanup; never needed to validate the current challenge.
  await db.prepare(
    "DELETE FROM patient_otp_challenges WHERE expires_at <= datetime('now', '-1 day')",
  ).run().catch(() => undefined);

  return { challengeId, code, expiresIn: PATIENT_OTP_TTL_SECONDS };
}

export async function verifyPatientOtpChallenge(
  db: D1Database,
  input: {
    challengeId: string;
    phoneNormalized: string;
    code: string;
    purpose?: string;
  },
): Promise<{ organizationId: number; identity: PatientIdentityScope; patientId?: string } | null> {
  const code = normalizeOtp(input.code);
  if (!/^[a-f0-9]{64}$/i.test(input.challengeId) || !input.phoneNormalized || !code) return null;
  const purpose = (input.purpose || "cabinet_login").slice(0, 40);

  const row = await db.prepare(
    `SELECT organization_id AS organizationId, identity_kind AS identityKind,
       identity_value AS identityValue, patient_id AS patientId,
       code_hash AS codeHash, attempts
     FROM patient_otp_challenges
     WHERE id = ? AND phone_normalized = ? AND purpose = ?
       AND identity_kind IN ('dob','booking') AND identity_value != ''
       AND consumed_at = '' AND expires_at > CURRENT_TIMESTAMP
       AND attempts < ?
     LIMIT 1`,
  ).bind(
    input.challengeId,
    input.phoneNormalized,
    purpose,
    PATIENT_OTP_MAX_ATTEMPTS,
  ).first<{
    organizationId: number;
    identityKind: "dob" | "booking";
    identityValue: string;
    patientId: string;
    codeHash: string;
    attempts: number;
  }>();
  if (!row) return null;

  const valid = await verifyPassword(code, row.codeHash);
  if (!valid) {
    await db.prepare(
      `UPDATE patient_otp_challenges SET attempts = attempts + 1
       WHERE id = ? AND consumed_at = '' AND attempts < ?`,
    ).bind(input.challengeId, PATIENT_OTP_MAX_ATTEMPTS).run();
    return null;
  }

  // One-time consumption is the replay guard. A simultaneous second verifier
  // sees zero changed rows and cannot establish another authenticated session.
  const consumed = await db.prepare(
    `UPDATE patient_otp_challenges
     SET consumed_at = CURRENT_TIMESTAMP, attempts = attempts + 1
     WHERE id = ? AND phone_normalized = ? AND purpose = ?
       AND consumed_at = '' AND expires_at > CURRENT_TIMESTAMP
       AND attempts < ?`,
  ).bind(
    input.challengeId,
    input.phoneNormalized,
    purpose,
    PATIENT_OTP_MAX_ATTEMPTS,
  ).run();
  if (!consumed.meta.changes) return null;
  return {
    organizationId: row.organizationId,
    identity: { kind: row.identityKind, value: row.identityValue },
    ...(row.patientId ? { patientId: row.patientId } : {}),
  };
}

export async function createPatientSession(
  db: D1Database,
  phoneNormalized: string,
  organizationId: number,
  identity: PatientIdentityScope,
  patientId = "",
): Promise<string> {
  const rawToken = newSessionToken();
  const tokenHash = await hashToken(rawToken);
  await db.prepare(
    `INSERT INTO patient_sessions
      (token_hash, phone_normalized, organization_id, identity_kind, identity_value, patient_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`,
  ).bind(
    tokenHash,
    phoneNormalized,
    organizationId,
    identity.kind,
    identity.value,
    patientId,
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
    `SELECT phone_normalized AS phoneNormalized, organization_id AS organizationId,
       identity_kind AS identityKind, identity_value AS identityValue,
       patient_id AS patientId
     FROM patient_sessions
     WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP
       AND identity_kind IN ('dob','booking') AND identity_value != ''
     LIMIT 1`,
  ).bind(tokenHash).first<{
    phoneNormalized: string;
    organizationId: number;
    identityKind: "dob" | "booking";
    identityValue: string;
    patientId: string;
  }>();
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
