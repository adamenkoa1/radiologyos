import { serviceByCode } from "../../../../lib/catalog";
import { canAccessBooking, canManageImaging } from "../../../../lib/staff-auth";
import {
  parseQidoSeries,
  qidoSeriesUrl,
  sanitizeImagingStudy,
} from "../../../../lib/dicom";
import { fetchLimited, readLimitedText, safeOutboundUrl } from "../../../../lib/outbound";
import { requireOrgContext } from "../../../../lib/tenant";
import { getOrgProfile } from "../../../../lib/org-profile";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

type PacsRow = {
  dicomwebBaseUrl:string; viewerBaseUrl:string; aeTitle:string; enabled:number;
};

async function loadPacs(db:D1Database):Promise<PacsRow> {
  const row = await db.prepare(
    `SELECT dicomweb_base_url AS dicomwebBaseUrl, viewer_base_url AS viewerBaseUrl,
       ae_title AS aeTitle, enabled FROM pacs_settings WHERE id = 1 LIMIT 1`
  ).first<PacsRow>();
  return row || { dicomwebBaseUrl:"", viewerBaseUrl:"", aeTitle:"", enabled:0 };
}

function publicSettings(pacs:PacsRow) {
  return {
    enabled:!!pacs.enabled,
    viewerBaseUrl:pacs.viewerBaseUrl,
    aeTitle:pacs.aeTitle,
    dicomwebConfigured:!!pacs.dicomwebBaseUrl,
  };
}

const STUDY_COLUMNS = `booking_id AS bookingId, accession_number AS accessionNumber,
  study_instance_uid AS studyInstanceUid, modality, series_count AS seriesCount,
  instances_count AS instancesCount, study_status AS studyStatus,
  study_datetime AS studyDatetime, source, updated_by AS updatedBy, updated_at AS updatedAt`;

// Best-effort DICOMweb QIDO-RS series lookup. Never throws: an unreachable or
// unconfigured PACS simply yields no series.
async function querySeries(pacs:PacsRow, studyInstanceUid:string) {
  if (!pacs.enabled || !pacs.dicomwebBaseUrl || !studyInstanceUid) return { series:[], reachable:true };
  try {
    const url = safeOutboundUrl(qidoSeriesUrl(pacs.dicomwebBaseUrl, studyInstanceUid));
    if (!url) return { series:[], reachable:false };
    const response = await fetchLimited(url, {
      headers:{ accept:"application/dicom+json" },
    }, 5000);
    if (!response.ok) return { series:[], reachable:false };
    return { series:parseQidoSeries(JSON.parse(await readLimitedText(response))), reachable:true };
  } catch {
    return { series:[], reachable:false };
  }
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageImaging(member.role)) {
    return Response.json({ error: "Доступ до знімків має лише залучений медичний персонал" }, { status: 403 });
  }
  if (!(await getOrgProfile(db, ctx)).flags.dicom_pacs) {
    return Response.json({ error: "Модуль DICOM / PACS вимкнено для цієї організації" }, { status: 403 });
  }

  const pacs = await loadPacs(db);
  const bookingId = Number(new URL(request.url).searchParams.get("bookingId"));

  if (Number.isInteger(bookingId) && bookingId > 0) {
    if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
      return Response.json({ error: "Немає доступу до цього дослідження" }, { status: 403 });
    }
    const [booking, study] = await Promise.all([
      db.prepare(
        `SELECT id, code, name, service, service_code AS serviceCode, equipment_id AS equipmentId,
          desired_date AS desiredDate, desired_time AS desiredTime, performed_at AS performedAt
         FROM bookings WHERE id = ? LIMIT 1`
      ).bind(bookingId).first<Record<string, unknown>>(),
      db.prepare(`SELECT ${STUDY_COLUMNS} FROM imaging_studies WHERE booking_id = ? LIMIT 1`).bind(bookingId).first<Record<string, unknown>>(),
    ]);
    if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });

    const studyInstanceUid = String(study?.studyInstanceUid || "");
    const { series, reachable } = await querySeries(pacs, studyInstanceUid);
    if (series.length) {
      const instances = series.reduce((sum, item) => sum + item.instances, 0);
      await db.prepare(
        `UPDATE imaging_studies SET series_count = ?, instances_count = ?,
           study_status = CASE WHEN study_status = 'archived' THEN 'archived' ELSE 'available' END
         WHERE booking_id = ?`
      ).bind(series.length, instances, bookingId).run();
    }
    return Response.json({
      booking, study: study || null, series,
      pacsReachable: reachable,
      settings: publicSettings(pacs),
      staff: member,
    }, { headers: { "cache-control": "no-store" } });
  }

  const assignmentClause = member.role === "radiologist"
    ? " AND b.assigned_radiologist_email = ?"
    : member.role === "radiographer"
      ? " AND b.assigned_radiographer_email = ?"
      : "";
  const worklistStatement = db.prepare(
    `SELECT b.id, b.code, b.name, b.service, b.service_code AS serviceCode,
       b.equipment_id AS equipmentId, b.desired_date AS desiredDate, b.desired_time AS desiredTime,
       b.performed_at AS performedAt, b.status,
       COALESCE(i.study_status, 'not_linked') AS studyStatus,
       COALESCE(i.accession_number, '') AS accessionNumber,
       COALESCE(i.study_instance_uid, '') AS studyInstanceUid,
       COALESCE(i.series_count, 0) AS seriesCount
     FROM bookings b
     LEFT JOIN imaging_studies i ON i.booking_id = b.id
     WHERE b.organization_id = ? AND b.status != 'cancelled' AND (b.performed_at != '' OR i.booking_id IS NOT NULL)
     ${assignmentClause}
     ORDER BY (b.performed_at != '') DESC, b.desired_date DESC, b.desired_time DESC
     LIMIT 300`
  );
  const worklistBinds: Array<string | number> = assignmentClause
    ? [ctx.organizationId, member.email]
    : [ctx.organizationId];
  const worklist = await worklistStatement.bind(...worklistBinds).all();
  const items = (worklist.results as Array<Record<string, unknown>>).map((item) => ({
    ...item,
    serviceTitle: serviceByCode(String(item.serviceCode))?.title || String(item.service),
  }));
  return Response.json({ worklist: items, settings: publicSettings(pacs), staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageImaging(member.role)) {
    return Response.json({ error: "Прив’язувати дослідження може лаборант, лікар або адміністратор" }, { status: 403 });
  }
  if (!(await getOrgProfile(db, ctx)).flags.dicom_pacs) {
    return Response.json({ error: "Модуль DICOM / PACS вимкнено для цієї організації" }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return Response.json({ error: "Некоректні дані" }, { status: 400 });
  if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
    return Response.json({ error: "Немає доступу до цього дослідження" }, { status: 403 });
  }
  const parsed = sanitizeImagingStudy(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { study } = parsed;

  const booking = await db.prepare("SELECT id FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1")
    .bind(bookingId, ctx.organizationId).first();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });

  // Нова студія успадковує організацію заявки (tenant tag на запис).
  await db.prepare(
    `INSERT INTO imaging_studies
       (organization_id, booking_id, accession_number, study_instance_uid, modality, study_status, study_datetime, source, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(booking_id) DO UPDATE SET
       accession_number = excluded.accession_number, study_instance_uid = excluded.study_instance_uid,
       modality = excluded.modality, study_status = excluded.study_status,
       study_datetime = excluded.study_datetime, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
  ).bind(
    ctx.organizationId, bookingId, study.accessionNumber, study.studyInstanceUid, study.modality,
    study.studyStatus, study.studyDatetime, member.email,
  ).run();

  await db.prepare(
    "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'imaging_linked', ?, ?)"
  ).bind(
    bookingId,
    `${study.studyStatus}${study.accessionNumber ? ` · ${study.accessionNumber}` : ""}${study.studyInstanceUid ? " · UID" : ""}`,
    member.email,
  ).run();

  return Response.json({ ok: true, study: { bookingId, ...study } });
}
