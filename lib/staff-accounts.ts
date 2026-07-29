// Staff account validation and administrator-owned account operations.

import { hashPassword } from "./auth";
import type { StaffRole } from "./staff-auth";

export const MIN_PASSWORD_LENGTH = 12;

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
