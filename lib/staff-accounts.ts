// Staff account validation and administrator-owned account operations.

import { hashPassword } from "./auth";
import type { StaffRole } from "./staff-auth";

// Спрощений код доступу: достатньо 6-значного PIN. Довші паролі також
// приймаються (сумісність зі старими акаунтами). Зберігається завжди
// хешованим (PBKDF2), вхід має обмеження спроб — короткий PIN не «голий».
export const MIN_PASSWORD_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{6}$/;

export function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

// Валідація коду доступу: 6-значний PIN або будь-яке значення 6–200 символів.
export function passwordProblem(secret: string): string | null {
  if (PIN_RE.test(secret)) return null;
  if (secret.length < MIN_PASSWORD_LENGTH) {
    return `Код доступу — щонайменше ${MIN_PASSWORD_LENGTH} символів (напр. 6-значний PIN)`;
  }
  if (secret.length > 200) return "Код доступу задовгий";
  return null;
}

export async function emailTaken(db: D1Database, email: string): Promise<boolean> {
  const row = await db.prepare("SELECT email FROM staff_members WHERE email = ? LIMIT 1")
    .bind(email).first<{ email: string }>();
  return !!row;
}

export interface StaffSummary { email: string; displayName: string; role: StaffRole }

// Create a new active staff member. Assumes the authenticated administrator has
// already selected the role and verified that the email is free.
export async function registerStaff(
  db: D1Database,
  input: { email: string; displayName: string; password: string; role: StaffRole },
): Promise<StaffSummary> {
  const passwordHash = await hashPassword(input.password);
  await db.prepare(
    `INSERT INTO staff_members (email, display_name, role, password_hash, active)
     VALUES (?, ?, ?, ?, 1)`
  ).bind(input.email, input.displayName, input.role, passwordHash).run();
  return { email: input.email, displayName: input.displayName, role: input.role };
}

// Set a new password for an existing member. Returns false when no such active
// member exists, and revokes any live sessions so a reset locks other devices out.
export async function resetStaffPassword(
  db: D1Database,
  email: string,
  password: string,
): Promise<boolean> {
  const member = await db.prepare(
    "SELECT email FROM staff_members WHERE email = ? AND active = 1 LIMIT 1"
  ).bind(email).first<{ email: string }>();
  if (!member) return false;
  const passwordHash = await hashPassword(password);
  await db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
    .bind(passwordHash, email).run();
  await db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(email).run();
  return true;
}
