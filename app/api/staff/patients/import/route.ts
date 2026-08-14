// Пакетний імпорт пацієнтів у CRM. Клієнт розбирає CSV і надсилає рядки;
// сервер валідує кожен через sanitizeProfile і робить upsert у
// patient_profiles. Лише реєстратор/адмін.

import { canManageBookings } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { sanitizeProfile } from "../../../../../lib/patients";
import { logSecurityEvent } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";

const MAX_ROWS = 5000;

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
    statements.push(db.prepare(
      `INSERT INTO patient_profiles
         (organization_id, phone_normalized, display_name, birth_year, birth_date, email, address, tags, notes, do_not_contact, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(organization_id, phone_normalized) DO UPDATE SET
         display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE patient_profiles.display_name END,
         birth_year = CASE WHEN excluded.birth_year != 0 THEN excluded.birth_year ELSE patient_profiles.birth_year END,
         birth_date = CASE WHEN excluded.birth_date != '' THEN excluded.birth_date ELSE patient_profiles.birth_date END,
         email = CASE WHEN excluded.email != '' THEN excluded.email ELSE patient_profiles.email END,
         address = CASE WHEN excluded.address != '' THEN excluded.address ELSE patient_profiles.address END,
         notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE patient_profiles.notes END,
         tags = excluded.tags,
         do_not_contact = excluded.do_not_contact,
         updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
    ).bind(
      ctx.organizationId, p.phoneNormalized, p.displayName, p.birthYear, p.birthDate, p.email, p.address,
      p.tags, p.notes, p.doNotContact, member.email,
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
