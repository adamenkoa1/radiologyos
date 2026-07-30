// Пакетний імпорт пацієнтів у CRM. Клієнт розбирає CSV і надсилає рядки;
// сервер валідує кожен через sanitizeProfile і робить upsert у
// patient_profiles. Лише реєстратор/адмін.

import { canManageBookings, requireStaff } from "../../../../../lib/staff-auth";
import { sanitizeProfile } from "../../../../../lib/patients";
import { logSecurityEvent } from "../../../../../lib/audit";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

const MAX_ROWS = 5000;

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageBookings(member.role)) {
    return Response.json({ error: "Імпортувати пацієнтів може реєстратор або адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { records?: unknown };
  const records = Array.isArray(body.records) ? body.records : [];
  if (!records.length) return Response.json({ error: "Немає рядків для імпорту" }, { status: 400 });
  if (records.length > MAX_ROWS) return Response.json({ error: `Забагато рядків (макс. ${MAX_ROWS})` }, { status: 400 });

  const statements: D1PreparedStatement[] = [];
  const errors: { row: number; error: string }[] = [];
  let imported = 0;
  records.forEach((raw, index) => {
    const parsed = sanitizeProfile(raw);
    if (!parsed.ok) { errors.push({ row: index + 1, error: parsed.error }); return; }
    const p = parsed.profile;
    imported += 1;
    statements.push(db.prepare(
      `INSERT INTO patient_profiles
         (phone_normalized, display_name, birth_year, birth_date, email, address, tags, notes, do_not_contact, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(phone_normalized) DO UPDATE SET
         display_name = excluded.display_name, birth_year = excluded.birth_year,
         birth_date = excluded.birth_date, email = excluded.email, address = excluded.address,
         notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE patient_profiles.notes END,
         updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
    ).bind(
      p.phoneNormalized, p.displayName, p.birthYear, p.birthDate, p.email, p.address,
      p.tags, p.notes, p.doNotContact, member.email,
    ));
  });

  // D1 batch по частинах, щоб не впертися в ліміт кількості операцій.
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }

  await logSecurityEvent(db, {
    actorEmail: member.email,
    action: "patients_imported",
    resource: "patient_registry",
    details: { imported, skipped: errors.length },
  });

  return Response.json({ ok: true, imported, skipped: errors.length, errors: errors.slice(0, 50) });
}
