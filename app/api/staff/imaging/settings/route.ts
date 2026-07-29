import { requireStaff } from "../../../../../lib/staff-auth";
import { sanitizePacsSettings } from "../../../../../lib/dicom";
import { safeOutboundUrl } from "../../../../../lib/outbound";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

const SETTINGS_COLUMNS = `dicomweb_base_url AS dicomwebBaseUrl, viewer_base_url AS viewerBaseUrl,
  ae_title AS aeTitle, enabled, notes, updated_by AS updatedBy, updated_at AS updatedAt`;

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Налаштування PACS доступні лише адміністратору" }, { status: 403 });

  const settings = await db.prepare(`SELECT ${SETTINGS_COLUMNS} FROM pacs_settings WHERE id = 1 LIMIT 1`).first();
  return Response.json({ settings: settings || null, staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Налаштування PACS може змінювати лише адміністратор" }, { status: 403 });

  const parsed = sanitizePacsSettings(await request.json());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { settings } = parsed;
  if (settings.dicomwebBaseUrl && !safeOutboundUrl(settings.dicomwebBaseUrl)) {
    return Response.json({ error: "Адреса DICOMweb заборонена політикою зовнішніх підключень" }, { status: 400 });
  }

  await db.prepare(
    `UPDATE pacs_settings SET dicomweb_base_url = ?, viewer_base_url = ?, ae_title = ?,
       enabled = ?, notes = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
  ).bind(
    settings.dicomwebBaseUrl, settings.viewerBaseUrl, settings.aeTitle,
    settings.enabled, settings.notes, member.email,
  ).run();

  return Response.json({ ok: true, settings: { ...settings, updatedBy: member.email } });
}
