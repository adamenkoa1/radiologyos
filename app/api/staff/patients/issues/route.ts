// Read-only аудит суперечностей між джерелами даних пацієнта в межах
// організації. Тільки реєстратор/адміністратор; нічого не змінює.

import { canViewPatientRegistry } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { logSecurityEvent } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import {
  countFindings, sortFindings,
  staleContactFindings, duplicatePhoneFindings, linkableBookingFindings, nameDivergenceFindings,
  type StaleContactRow, type DuplicatePhoneRow, type LinkableBookingRow, type NameDivergenceRow,
} from "../../../../../lib/patient-consistency";

const LIMIT = 500;

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const orgId = ctx.organizationId;
  if (!canViewPatientRegistry(member.role)) {
    return Response.json({ error: "Аудит карток доступний лише реєстратору або адміністратору" }, { status: 403 });
  }

  // Контакт exact-пацієнта в заявці розійшовся з карткою.
  const staleP = db.prepare(
    `SELECT b.id AS bookingId, b.code, b.name AS bookingName, b.phone_normalized AS bookingPhone,
       p.patient_id AS patientId, p.display_name AS displayName, p.phone_normalized AS profilePhone
     FROM bookings b
     JOIN patient_profiles p ON p.organization_id = b.organization_id AND p.patient_id = b.patient_id
     WHERE b.organization_id = ? AND b.patient_id != '' AND b.phone_normalized != ''
       AND b.phone_normalized != p.phone_normalized
     ORDER BY b.desired_date DESC LIMIT ?`
  ).bind(orgId, LIMIT).all();

  // Один номер у кількох картках — можливі дублікати / неоднозначна ідентичність.
  const dupP = db.prepare(
    `SELECT phone_normalized AS phoneNormalized, COUNT(*) AS count,
       GROUP_CONCAT(CASE WHEN display_name = '' THEN 'без імені' ELSE display_name END, ' | ') AS names
     FROM patient_profiles
     WHERE organization_id = ? AND phone_normalized != ''
     GROUP BY phone_normalized HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC LIMIT ?`
  ).bind(orgId, LIMIT).all();

  // Неприв'язана заявка, чий номер збігається РІВНО з однією карткою.
  const linkP = db.prepare(
    `SELECT b.id AS bookingId, b.code, b.name AS bookingName, b.phone_normalized AS phoneNormalized,
       p.patient_id AS patientId, p.display_name AS displayName
     FROM bookings b
     JOIN patient_profiles p ON p.organization_id = b.organization_id AND p.phone_normalized = b.phone_normalized
     WHERE b.organization_id = ? AND b.patient_id = '' AND b.phone_normalized != ''
       AND (SELECT COUNT(*) FROM patient_profiles p2
            WHERE p2.organization_id = b.organization_id AND p2.phone_normalized = b.phone_normalized) = 1
     ORDER BY b.desired_date DESC LIMIT ?`
  ).bind(orgId, LIMIT).all();

  // Кандидати для звірки ПІБ (розбіжність рахуємо в чистій логіці).
  const nameP = db.prepare(
    `SELECT b.id AS bookingId, b.code, b.name AS bookingName,
       p.patient_id AS patientId, p.display_name AS displayName, p.phone_normalized AS phoneNormalized
     FROM bookings b
     JOIN patient_profiles p ON p.organization_id = b.organization_id AND p.patient_id = b.patient_id
     WHERE b.organization_id = ? AND b.name != '' AND p.display_name != ''
     ORDER BY b.desired_date DESC LIMIT ?`
  ).bind(orgId, LIMIT * 2).all();

  const [stale, dup, link, names] = await Promise.all([staleP, dupP, linkP, nameP]);

  const findings = sortFindings([
    ...staleContactFindings(stale.results as unknown as StaleContactRow[]),
    ...duplicatePhoneFindings(dup.results as unknown as DuplicatePhoneRow[]),
    ...linkableBookingFindings(link.results as unknown as LinkableBookingRow[]),
    ...nameDivergenceFindings(names.results as unknown as NameDivergenceRow[]),
  ]);
  const counts = countFindings(findings);

  await logSecurityEvent(db, {
    organizationId: orgId,
    actorEmail: member.email,
    action: "patient_consistency_viewed",
    resource: "patient_registry",
    details: { total: counts.total },
  });

  return Response.json({ findings, counts, staff: member }, { headers: { "cache-control": "no-store" } });
}
