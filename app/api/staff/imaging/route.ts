import { serviceByCode } from "../../../../lib/catalog";
import { canAccessBooking, canManageImaging } from "../../../../lib/staff-auth";
import {
  checkDicomAutoLinkMatch,
  isValidAccession,
  parseQidoSeries,
  parseQidoStudies,
  qidoSeriesUrl,
  qidoStudiesByAccessionUrl,
  sanitizeImagingStudy,
  viewerUrl,
} from "../../../../lib/dicom";
import { modalityForWorklist } from "../../../../lib/mwl-bridge";
import { fetchLimited, readLimitedText, safeOutboundUrl } from "../../../../lib/outbound";
import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

type PacsRow = {
  dicomwebBaseUrl:string; viewerBaseUrl:string; aeTitle:string; enabled:number;
};

async function loadPacs(db:D1Database, organizationId:number):Promise<PacsRow> {
  const row = await db.prepare(
    `SELECT dicomweb_base_url AS dicomwebBaseUrl, viewer_base_url AS viewerBaseUrl,
       ae_title AS aeTitle, enabled FROM pacs_settings WHERE organization_id = ? LIMIT 1`
  ).bind(organizationId).first<PacsRow>();
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

async function querySeries(pacs:PacsRow, studyInstanceUid:string) {
  if (!pacs.enabled || !pacs.dicomwebBaseUrl || !studyInstanceUid) return { series:[], reachable:true };
  try {
    const url = safeOutboundUrl(qidoSeriesUrl(pacs.dicomwebBaseUrl, studyInstanceUid));
    if (!url) return { series:[], reachable:false };
    const response = await fetchLimited(url, { headers:{ accept:"application/dicom+json" } }, 5000);
    if (!response.ok) return { series:[], reachable:false };
    return { series:parseQidoSeries(JSON.parse(await readLimitedText(response))), reachable:true };
  } catch {
    return { series:[], reachable:false };
  }
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  const member = ctx.member;
  if (!canManageImaging(member.role)) {
    return Response.json({ error:"Доступ до знімків має лише залучений медичний персонал" }, { status:403 });
  }

  const pacs = await loadPacs(db, ctx.organizationId);
  const bookingId = Number(new URL(request.url).searchParams.get("bookingId"));
  if (Number.isInteger(bookingId) && bookingId > 0) {
    if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
      return Response.json({ error:"Немає доступу до цього дослідження" }, { status:403 });
    }
    const [booking, study] = await Promise.all([
      db.prepare(
        `SELECT id, code, name, service, service_code AS serviceCode, equipment_id AS equipmentId,
          desired_date AS desiredDate, desired_time AS desiredTime, performed_at AS performedAt
         FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1`
      ).bind(bookingId, ctx.organizationId).first<Record<string, unknown>>(),
      db.prepare(`SELECT ${STUDY_COLUMNS} FROM imaging_studies WHERE booking_id = ? AND organization_id = ? LIMIT 1`)
        .bind(bookingId, ctx.organizationId).first<Record<string, unknown>>(),
    ]);
    if (!booking) return Response.json({ error:"Заявку не знайдено" }, { status:404 });

    const studyInstanceUid = String(study?.studyInstanceUid || "");
    const { series, reachable } = await querySeries(pacs, studyInstanceUid);
    if (series.length) {
      const instances = series.reduce((sum, item) => sum + item.instances, 0);
      await db.prepare(
        `UPDATE imaging_studies SET series_count = ?, instances_count = ?,
           study_status = CASE WHEN study_status = 'archived' THEN 'archived' ELSE 'available' END
         WHERE booking_id = ? AND organization_id = ?`
      ).bind(series.length, instances, bookingId, ctx.organizationId).run();
    }
    await audit(db, {
      organizationId: ctx.organizationId,
      actorEmail: member.email,
      action: "imaging_study_viewed",
      resource: "imaging",
      targetId: bookingId,
      details: { linked: !!study, seriesCount: series.length },
    });
    return Response.json({
      booking,
      study:study || null,
      series,
      pacsReachable:reachable,
      viewerUrl:viewerUrl(pacs.viewerBaseUrl, studyInstanceUid),
      settings:publicSettings(pacs),
      staff:member,
    }, { headers:{ "cache-control":"no-store" } });
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
     LEFT JOIN imaging_studies i ON i.booking_id = b.id AND i.organization_id = b.organization_id
     WHERE b.organization_id = ? AND b.status != 'cancelled' AND (b.performed_at != '' OR i.booking_id IS NOT NULL)
     ${assignmentClause}
     ORDER BY (b.performed_at != '') DESC, b.desired_date DESC, b.desired_time DESC
     LIMIT 300`
  );
  const worklistBinds:Array<string | number> = assignmentClause ? [ctx.organizationId, member.email] : [ctx.organizationId];
  const worklist = await worklistStatement.bind(...worklistBinds).all();
  const items = (worklist.results as Array<Record<string, unknown>>).map((item) => ({
    ...item,
    serviceTitle:serviceByCode(String(item.serviceCode))?.title || String(item.service),
  }));
  return Response.json({ worklist:items, settings:publicSettings(pacs), staff:member }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  const member = ctx.member;
  if (!canManageImaging(member.role)) {
    return Response.json({ error:"Прив’язувати дослідження може лаборант, лікар або адміністратор" }, { status:403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return Response.json({ error:"Некоректні дані" }, { status:400 });
  if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
    return Response.json({ error:"Немає доступу до цього дослідження" }, { status:403 });
  }

  type AutoLinkBooking = {
    id:number; code:string; serviceCode:string; equipmentId:string; desiredDate:string; performedAt:string;
  };
  const [booking, existing, pacs] = await Promise.all([
    db.prepare(`SELECT id, code, service_code AS serviceCode, equipment_id AS equipmentId,
        desired_date AS desiredDate, performed_at AS performedAt
       FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1`)
      .bind(bookingId, ctx.organizationId).first<AutoLinkBooking>(),
    db.prepare(`SELECT accession_number AS accessionNumber FROM imaging_studies WHERE booking_id = ? AND organization_id = ? LIMIT 1`)
      .bind(bookingId, ctx.organizationId).first<{ accessionNumber:string }>(),
    loadPacs(db, ctx.organizationId),
  ]);
  if (!booking) return Response.json({ error:"Заявку не знайдено" }, { status:404 });
  if (!pacs.enabled || !pacs.dicomwebBaseUrl) {
    return Response.json({ error:"PACS не налаштовано або вимкнено", status:"not_configured" }, { status:409 });
  }

  const accessionNumber = String(existing?.accessionNumber || booking.code).trim();
  if (!isValidAccession(accessionNumber) || !accessionNumber) {
    return Response.json({ error:"Для заявки немає коректного AccessionNumber", status:"invalid_accession" }, { status:409 });
  }

  const queryUrl = safeOutboundUrl(qidoStudiesByAccessionUrl(pacs.dicomwebBaseUrl, accessionNumber));
  if (!queryUrl) {
    return Response.json({ error:"Адреса PACS заборонена політикою зовнішніх підключень", status:"unreachable" }, { status:502 });
  }

  let matches;
  try {
    const response = await fetchLimited(queryUrl, { headers:{ accept:"application/dicom+json" } }, 5000);
    if (!response.ok) return Response.json({ error:"PACS не відповів на пошук", status:"unreachable" }, { status:502 });
    matches = parseQidoStudies(JSON.parse(await readLimitedText(response)))
      .filter((study) => study.accessionNumber === accessionNumber);
  } catch {
    return Response.json({ error:"PACS тимчасово недоступний", status:"unreachable" }, { status:502 });
  }

  if (matches.length === 0) return Response.json({ ok:false, status:"not_found", accessionNumber }, { status:404 });
  if (matches.length !== 1) {
    return Response.json({ ok:false, status:"ambiguous", accessionNumber, matches:matches.length }, { status:409 });
  }

  const match = matches[0];
  const expectedModality = modalityForWorklist(booking.serviceCode, booking.equipmentId);
  const expectedDate = String(booking.performedAt || booking.desiredDate).slice(0, 10);
  const metadataCheck = checkDicomAutoLinkMatch(match, expectedModality, expectedDate);
  if (!metadataCheck.ok) {
    await db.prepare(
      `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
       VALUES (?, ?, 'imaging_auto_link_rejected', ?, ?)`
    ).bind(ctx.organizationId, bookingId, `QIDO-RS · ${metadataCheck.reason}`, member.email).run();
    return Response.json({
      ok:false,
      status:"metadata_mismatch",
      reason:metadataCheck.reason,
      accessionNumber,
      expected:{ modality:expectedModality, date:expectedDate },
    }, { status:409 });
  }

  const seriesResult = await querySeries(pacs, match.studyInstanceUid);
  const seriesCount = seriesResult.series.length || match.seriesCount;
  const instancesCount = seriesResult.series.length
    ? seriesResult.series.reduce((sum, item) => sum + item.instances, 0)
    : match.instancesCount;

  await db.prepare(
    `INSERT INTO imaging_studies
      (organization_id, booking_id, accession_number, study_instance_uid, modality,
       series_count, instances_count, study_status, study_datetime, source, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, 'qido_accession', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(booking_id) DO UPDATE SET
       organization_id = excluded.organization_id,
       accession_number = excluded.accession_number,
       study_instance_uid = excluded.study_instance_uid,
       modality = excluded.modality,
       series_count = excluded.series_count,
       instances_count = excluded.instances_count,
       study_status = 'available',
       study_datetime = excluded.study_datetime,
       source = 'qido_accession',
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    ctx.organizationId, bookingId, accessionNumber, match.studyInstanceUid, match.modality,
    seriesCount, instancesCount, match.studyDatetime, member.email,
  ).run();

  await db.prepare(
    `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
     VALUES (?, ?, 'imaging_auto_linked', ?, ?)`
  ).bind(ctx.organizationId, bookingId, `${accessionNumber} · QIDO-RS`, member.email).run();

  return Response.json({
    ok:true,
    status:"linked",
    study:{
      bookingId,
      accessionNumber,
      studyInstanceUid:match.studyInstanceUid,
      modality:match.modality,
      seriesCount,
      instancesCount,
      studyStatus:"available",
      studyDatetime:match.studyDatetime,
      source:"qido_accession",
    },
    viewerUrl:viewerUrl(pacs.viewerBaseUrl, match.studyInstanceUid),
    pacsReachable:seriesResult.reachable,
  }, { headers:{ "cache-control":"no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  const member = ctx.member;
  if (!canManageImaging(member.role)) {
    return Response.json({ error:"Прив’язувати дослідження може лаборант, лікар або адміністратор" }, { status:403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return Response.json({ error:"Некоректні дані" }, { status:400 });
  if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
    return Response.json({ error:"Немає доступу до цього дослідження" }, { status:403 });
  }
  const parsed = sanitizeImagingStudy(body);
  if (!parsed.ok) return Response.json({ error:parsed.error }, { status:400 });
  const { study } = parsed;

  const booking = await db.prepare("SELECT id FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1")
    .bind(bookingId, ctx.organizationId).first();
  if (!booking) return Response.json({ error:"Заявку не знайдено" }, { status:404 });

  await db.prepare(
    `INSERT INTO imaging_studies
       (organization_id, booking_id, accession_number, study_instance_uid, modality,
        series_count, instances_count, study_status, study_datetime, source, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'manual', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(booking_id) DO UPDATE SET
       organization_id = excluded.organization_id,
       accession_number = excluded.accession_number,
       study_instance_uid = excluded.study_instance_uid,
       modality = excluded.modality,
       series_count = 0,
       instances_count = 0,
       study_status = excluded.study_status,
       study_datetime = excluded.study_datetime,
       source = 'manual',
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    ctx.organizationId, bookingId, study.accessionNumber, study.studyInstanceUid, study.modality,
    study.studyStatus, study.studyDatetime, member.email,
  ).run();

  await db.prepare(
    "INSERT INTO booking_events (organization_id, booking_id, action, details, actor) VALUES (?, ?, 'imaging_linked', ?, ?)"
  ).bind(
    ctx.organizationId,
    bookingId,
    `${study.studyStatus}${study.accessionNumber ? ` · ${study.accessionNumber}` : ""}${study.studyInstanceUid ? " · UID" : ""}`,
    member.email,
  ).run();

  return Response.json({ ok:true, study:{ bookingId, ...study, seriesCount:0, instancesCount:0, source:"manual" } });
}