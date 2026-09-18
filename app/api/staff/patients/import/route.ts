// Пакетний імпорт пацієнтів у CRM. Клієнт розбирає CSV і надсилає рядки;
// сервер валідує кожен через sanitizeProfile. patient_id, якщо він наданий,
// означає точне оновлення існуючої картки. Рядок без patient_id створює нову
// картку і НІКОЛИ не робить upsert за телефоном: спільний номер не є identity.

import { canManageBookings } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { sanitizeProfile } from "../../../../../lib/patients";
import { logSecurityEvent } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";

const MAX_ROWS = 5000;
const PATIENT_ID_RE = /^[0-9a-f]{32}$/;

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageBookings(member.role)) {
    return Response.json({ error: "Імпортувати пацієнтів може реєстратор або адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { records?: unknown };
  const records = Array.isArray(body.records) ? body.records : [];
  if (!records.length) return Response.json({ error: "Немає рядків для імпорту" }, { status: 400 });
  if (records.length > MAX_ROWS) return Response.json({ error: `Забагато рядків (макс. ${MAX_ROWS})` }, { status: 400 });

  const statements: D1PreparedStatement[] = [];
  const errors: { row: number; error: string }[] = [];
  records.forEach((raw, index) => {
    const parsed = sanitizeProfile(raw);
    if (!parsed.ok) { errors.push({ row: index + 1, error: parsed.error }); return; }
    const p = parsed.profile;
    const patientId = raw && typeof raw === "object"
      ? String((raw as Record<string,unknown>).patientId || "").trim().toLowerCase()
      : "";
    if (patientId && !PATIENT_ID_RE.test(patientId)) {
      errors.push({ row: index + 1, error: "Некоректний patient_id" });
      return;
    }

    if (patientId) {
      statements.push(db.prepare(
        `UPDATE patient_profiles SET
           phone_normalized = ?,
           display_name = CASE WHEN ? != '' THEN ? ELSE display_name END,
           birth_year = CASE WHEN ? != 0 THEN ? ELSE birth_year END,
           birth_date = CASE WHEN ? != '' THEN ? ELSE birth_date END,
           email = CASE WHEN ? != '' THEN ? ELSE email END,
           address = CASE WHEN ? != '' THEN ? ELSE address END,
           notes = CASE WHEN ? != '' THEN ? ELSE notes END,
           tags = ?, do_not_contact = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = ? AND patient_id = ?`
      ).bind(
        p.phoneNormalized,
        p.displayName, p.displayName,
        p.birthYear, p.birthYear,
        p.birthDate, p.birthDate,
        p.email, p.email,
        p.address, p.address,
        p.notes, p.notes,
        p.tags, p.doNotContact, member.email,
        ctx.organizationId, patientId,
      ));
      return;
    }

    const newPatientId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    statements.push(db.prepare(
      `INSERT INTO patient_profiles
         (patient_id, organization_id, phone_normalized, display_name, birth_year, birth_date, email, address, tags, notes, do_not_contact, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      newPatientId, ctx.organizationId, p.phoneNormalized, p.displayName, p.birthYear,
      p.birthDate, p.email, p.address, p.tags, p.notes, p.doNotContact, member.email,
    ));
  });

  let imported = 0;
  for (let i = 0; i < statements.length; i += 50) {
    const results = await db.batch(statements.slice(i, i + 50));
    imported += results.reduce((sum, result) => sum + (Number(result.meta?.changes || 0) > 0 ? 1 : 0), 0);
  }
  const skipped = errors.length + (statements.length - imported);

  await logSecurityEvent(db, {
    organizationId: ctx.organizationId,
    actorEmail: member.email,
    action: "patients_imported",
    resource: "patient_registry",
    details: { imported, skipped },
  });
  return Response.json({ ok: true, imported, skipped, errors: errors.slice(0, 50) });
}
