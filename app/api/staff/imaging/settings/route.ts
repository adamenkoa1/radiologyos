import { sanitizePacsSettings } from "../../../../../lib/dicom";
import { safeOutboundUrl } from "../../../../../lib/outbound";
import { canManageSystem } from "../../../../../lib/staff-auth";
import { requireSystemOrgContext } from "../../../../../lib/tenant";
import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";

const SETTINGS_COLUMNS = `dicomweb_base_url AS dicomwebBaseUrl, viewer_base_url AS viewerBaseUrl,
  ae_title AS aeTitle, enabled, notes, updated_by AS updatedBy, updated_at AS updatedAt`;

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageSystem(ctx.member.role)) {
    return Response.json({ error: "Налаштування PACS доступні лише системному адміністратору" }, { status: 403 });
  }

  const settings = await db.prepare(
    `SELECT ${SETTINGS_COLUMNS} FROM pacs_settings WHERE organization_id = ? LIMIT 1`,
  ).bind(ctx.organizationId).first();
  return Response.json({ settings: settings || null, staff: ctx.member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageSystem(ctx.member.role)) {
    return Response.json({ error: "Налаштування PACS може змінювати лише системний адміністратор" }, { status: 403 });
  }

  const parsed = sanitizePacsSettings(await request.json());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { settings } = parsed;
  if (settings.dicomwebBaseUrl && !safeOutboundUrl(settings.dicomwebBaseUrl)) {
    return Response.json({ error: "Адреса DICOMweb заборонена політикою зовнішніх підключень" }, { status: 400 });
  }

  await db.prepare(
    `INSERT INTO pacs_settings
      (organization_id, dicomweb_base_url, viewer_base_url, ae_title, enabled, notes, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id) DO UPDATE SET
       dicomweb_base_url = excluded.dicomweb_base_url,
       viewer_base_url = excluded.viewer_base_url,
       ae_title = excluded.ae_title,
       enabled = excluded.enabled,
       notes = excluded.notes,
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    ctx.organizationId,
    settings.dicomwebBaseUrl,
    settings.viewerBaseUrl,
    settings.aeTitle,
    settings.enabled,
    settings.notes,
    ctx.member.email,
  ).run();

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "pacs_update",
    resource: "pacs_settings",
    details: { enabled: !!settings.enabled },
  });

  return Response.json({ ok: true, settings: { ...settings, updatedBy: ctx.member.email } });
}
