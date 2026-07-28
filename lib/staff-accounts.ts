// Self-service staff account operations: registration and password reset,
// both authorised by the shared department access code. No external identity
// provider or email delivery is required — the application owns the whole flow.

import { hashPassword, verifyPassword } from "./auth";
import type { StaffRole } from "./staff-auth";

// New self-registered members join as registrars so they can immediately work
// the booking queue. An administrator can adjust roles afterwards.
export const DEFAULT_SELF_REGISTER_ROLE: StaffRole = "registrar";
export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

// Validate a proposed password, returning an error message or null when valid.
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів`;
  }
  if (password.length > 200) return "Пароль задовгий";
  if (!/[A-Za-zА-Яа-яЇїІіЄєҐґ]/.test(password) || !/\d/.test(password)) {
    return "Пароль має містити щонайменше одну літеру та одну цифру";
  }
  return null;
}

async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(key).first<{ value: string }>();
  return row?.value || "";
}

// Confirm the supplied department access code against the stored hash.
export async function verifyAccessCode(db: D1Database, code: string): Promise<boolean> {
  const encoded = await getSetting(db, "registration_code_hash");
  if (!encoded) return false;
  return verifyPassword(code.trim(), encoded);
}

export async function emailTaken(db: D1Database, email: string): Promise<boolean> {
  const row = await db.prepare("SELECT email FROM staff_members WHERE email = ? LIMIT 1")
    .bind(email).first<{ email: string }>();
  return !!row;
}

export interface StaffSummary { email: string; displayName: string; role: StaffRole }

// Create a new active staff member. Assumes the caller has already verified the
// access code and that the email is free.
export async function registerStaff(
  db: D1Database,
  input: { email: string; displayName: string; password: string; role?: StaffRole },
): Promise<StaffSummary> {
  const role = input.role || DEFAULT_SELF_REGISTER_ROLE;
  const passwordHash = await hashPassword(input.password);
  await db.prepare(
    `INSERT INTO staff_members (email, display_name, role, password_hash, active)
     VALUES (?, ?, ?, ?, 1)`
  ).bind(input.email, input.displayName, role, passwordHash).run();
  return { email: input.email, displayName: input.displayName, role };
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
