import { serviceByCode } from "../../../../lib/catalog";
import { canAccessBooking, canManageImaging } from "../../../../lib/staff-auth";
import {
  checkDicomAutoLinkMatch,
  isValidAccession,
  parseQidoSeries,
  parseQidoStudies,
  qidoSeriesUrl,
  qidoStudiesByAccessionUrl,
  qidoStudiesByUidUrl,
  sanitizeImagingStudy,
  viewerUrl,
  type DicomStudyMatch,
} from "../../../../lib/dicom";
import { modalityForWorklist, mwlIdentityKey } from "../../../../lib/mwl-bridge";
import { fetchLimited, readLimitedText, safeOutboundUrl } from "../../../../lib/outbound";
import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

type PacsRow = {
  dicomwebBaseUrl:string; viewerBaseUrl:string; aeTitle:string; enabled:number;
};

type ImagingBooking = {
  id:number;
  code:string;
  patientId:string;
  serviceCode:string;
  equipmentId:string;
  desiredDate:string;
  performedAt:string;
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

async function expectedMwlPatientId(db:D1Database, organizationId:number, booking:ImagingBooking):Promise<string> {
  const key = mwlIdentityKey(booking.patientId, booking.code);
  const row = await db.prepare(
    `SELECT patient_id AS patientId FROM mwl_patient_ids
     WHERE organization_id = ? AND identity_key = ? LIMIT 1`
  ).bind(organizationId, key).first<{ patientId:string }>();
  return String(row?.patientId || "");
}

async function checkPacsPatientIdentity(
  db:D1Database,
  organizationId:number,
  booking:ImagingBooking,
  study:DicomStudyMatch,
):Promise<{ ok:true } | { ok:false; reason:"patient_id_missing" | "patient_id_mismatch" | "patient_identity_unverified" }> {
  // Once immutable MWL identity exists it is authoritative even when PACS
  // reports the canonical RadiologyOS accession. Accession-only acceptance is
  // retained solely for historical studies that predate MWL PatientID binding.
  const expectedPatientId = await expectedMwlPatientId(db, organizationId, booking);
  if (expectedPatientId) {
    if (!study.patientId) return { ok:false, reason:"patient_id_missing" };
    if (study.patientId !== expectedPatientId) return { ok:false, reason:"patient_id_mismatch" };
    return { ok:true };
  }

  if (study.accessionNumber === booking.code) return { ok:true };
  return { ok:false, reason:"patient_identity_unverified" };
}

async function qidoStudies(pacs:PacsRow, rawUrl:string):Promise<{ ok:true; studies:DicomStudyMatch[] } | { ok:false; error:"blocked" | "unreachable" }> {
  const url = safeOutboundUrl(rawUrl);
  if (!url) return { ok:false, error:"blocked" };
  try {
    const response = await fetchLimited(url, { headers:{ accept:"application/dicom+json" } }, 5000);
    if (!response.ok) return { ok:false, error:"unreachable" };
    return { ok:true, studies:parseQidoStudies(JSON.parse(await readLimitedText(response))) };
  } catch {
    return { ok:false, error:"unreachable" };
  }
}

async function recordRejected(
  db:D1Database,
  organizationId:number,
  bookingId:number,
  action:string,
  reason:string,
  actor:string,
) {
  await db.prepare(
    `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(organizationId, bookingId, action, `PACS verification · ${reason}`, actor).run();
}

function isSignedImagingIdentityLock(error:unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /signed protocol imaging identity is immutable/i.test(message);
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

    const storedUid = String(study?.studyInstanceUid || "");
    const linkVerificationRequired = !!storedUid && String(study?.source || "") === "manual";
    // Historical manual UIDs predate PACS-backed identity verification. Preserve
    // the DB record but do not expose the untrusted UID/viewer until re-verification.
    const trustedUid = linkVerificationRequired ? "" : storedUid;
    const publicStudy = study
      ? { ...study, studyInstanceUid:linkVerificationRequired ? "" : storedUid }
      : null;
    const { series, reachable } = await querySeries(pacs, trustedUid);
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
      details: { linked: !!study, seriesCount: series.length, linkVerificationRequired },
    });
    return Response.json({
      booking,
      study:publicStudy,
      series,
      pacsReachable:reachable,
      viewerUrl:viewerUrl(pacs.viewerBaseUrl, trustedUid),
      linkVerificationRequired,
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
       CASE WHEN COALESCE(i.source, '') = 'manual' AND COALESCE(i.study_instance_uid, '') != ''
         THEN '' ELSE COALESCE(i.study_instance_uid, '') END AS studyInstanceUid,
       CASE WHEN COALESCE(i.source, '') = 'manual' AND COALESCE(i.study_instance_uid, '') != ''
         THEN 1 ELSE 0 END AS linkVerificationRequired,
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

  const [booking, existing, pacs] = await Promise.all([
    db.prepare(`SELECT id, code, patient_id AS patientId, service_code AS serviceCode, equipment_id AS equipmentId,
        desired_date AS desiredDate, performed_at AS performedAt
       FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1`)
      .bind(bookingId, ctx.organizationId).first<ImagingBooking>(),
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

  const studiesResult = await qidoStudies(pacs, qidoStudiesByAccessionUrl(pacs.dicomwebBaseUrl, accessionNumber));
  if (!studiesResult.ok) {
    const error = studiesResult.error === "blocked"
      ? "Адреса PACS заборонена політикою зовнішніх підключень"
      : "PACS тимчасово недоступний";
    return Response.json({ error, status:"unreachable" }, { status:502 });
  }
  const matches = studiesResult.studies.filter((study) => study.accessionNumber === accessionNumber);

  if (matches.length === 0) return Response.json({ ok:false, status:"not_found", accessionNumber }, { status:404 });
  if (matches.length !== 1) {
    return Response.json({ ok:false, status:"ambiguous", accessionNumber, matches:matches.length }, { status:409 });
  }

  const match = matches[0];
  const expectedModality = modalityForWorklist(booking.serviceCode, booking.equipmentId);
  const expectedDate = String(booking.performedAt || booking.desiredDate).slice(0, 10);
  const metadataCheck = checkDicomAutoLinkMatch(match, expectedModality, expectedDate);
  if (!metadataCheck.ok) {
    await recordRejected(db, ctx.organizationId, bookingId, "imaging_auto_link_rejected", metadataCheck.reason, member.email);
    return Response.json({
      ok:false,
      status:"metadata_mismatch",
      reason:metadataCheck.reason,
      accessionNumber,
      expected:{ modality:expectedModality, date:expectedDate },
    }, { status:409 });
  }

  const identityCheck = await checkPacsPatientIdentity(db, ctx.organizationId, booking, match);
  if (!identityCheck.ok) {
    await recordRejected(db, ctx.organizationId, bookingId, "imaging_auto_link_rejected", identityCheck.reason, member.email);
    return Response.json({
      ok:false,
      status:"identity_mismatch",
      reason:identityCheck.reason,
      accessionNumber,
    }, { status:409 });
  }

  const seriesResult = await querySeries(pacs, match.studyInstanceUid);
  const seriesCount = seriesResult.series.length || match.seriesCount;
  const instancesCount = seriesResult.series.length
    ? seriesResult.series.reduce((sum, item) => sum + item.instances, 0)
    : match.instancesCount;

  try {
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
  } catch (error) {
  if (!isSignedImagingIdentityLock(error)) throw error;
  await recordRejected(db, ctx.organizationId, bookingId, "imaging_relink_rejected", "signed_protocol_identity_locked", member.email);
  return Response.json({
    ok:false,
    status:"locked",
    reason:"signed_protocol_identity_locked",
  }, { status:409 });
}

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

  const [booking, pacs] = await Promise.all([
    db.prepare(`SELECT id, code, patient_id AS patientId, service_code AS serviceCode, equipment_id AS equipmentId,
        desired_date AS desiredDate, performed_at AS performedAt
       FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1`)
      .bind(bookingId, ctx.organizationId).first<ImagingBooking>(),
    loadPacs(db, ctx.organizationId),
  ]);
  if (!booking) return Response.json({ error:"Заявку не знайдено" }, { status:404 });

  let accessionNumber = study.accessionNumber;
  let studyInstanceUid = study.studyInstanceUid;
  let modality = study.modality;
  let studyDatetime = study.studyDatetime;
  let studyStatus = study.studyStatus;
  let seriesCount = 0;
  let instancesCount = 0;
  let source = "manual";

  if (study.studyInstanceUid) {
    if (!pacs.enabled || !pacs.dicomwebBaseUrl) {
      return Response.json({
        error:"StudyInstanceUID можна прив’язати лише після перевірки в PACS",
        status:"verification_unavailable",
      }, { status:409 });
    }

    const studiesResult = await qidoStudies(pacs, qidoStudiesByUidUrl(pacs.dicomwebBaseUrl, study.studyInstanceUid));
    if (!studiesResult.ok) {
      const reason = studiesResult.error === "blocked" ? "pacs_url_blocked" : "pacs_unreachable";
      await recordRejected(db, ctx.organizationId, bookingId, "imaging_manual_link_rejected", reason, member.email);
      return Response.json({ error:"PACS не вдалося перевірити", status:"verification_unavailable" }, { status:502 });
    }
    const matches = studiesResult.studies.filter((item) => item.studyInstanceUid === study.studyInstanceUid);
    if (matches.length === 0) {
      await recordRejected(db, ctx.organizationId, bookingId, "imaging_manual_link_rejected", "uid_not_found", member.email);
      return Response.json({ ok:false, status:"not_found" }, { status:404 });
    }
    if (matches.length !== 1) {
      await recordRejected(db, ctx.organizationId, bookingId, "imaging_manual_link_rejected", "uid_ambiguous", member.email);
      return Response.json({ ok:false, status:"ambiguous", matches:matches.length }, { status:409 });
    }

    const match = matches[0];
    if (!match.accessionNumber || !isValidAccession(match.accessionNumber)) {
      await recordRejected(db, ctx.organizationId, bookingId, "imaging_manual_link_rejected", "missing_accession", member.email);
      return Response.json({ ok:false, status:"metadata_mismatch", reason:"missing_accession" }, { status:409 });
    }
    if (study.accessionNumber && study.accessionNumber !== match.accessionNumber) {
      await recordRejected(db, ctx.organizationId, bookingId, "imaging_manual_link_rejected", "accession_mismatch", member.email);
      return Response.json({ ok:false, status:"metadata_mismatch", reason:"accession_mismatch" }, { status:409 });
    }

    const expectedModality = modalityForWorklist(booking.serviceCode, booking.equipmentId);
    const expectedDate = String(booking.performedAt || booking.desiredDate).slice(0, 10);
    const metadataCheck = checkDicomAutoLinkMatch(match, expectedModality, expectedDate);
    if (!metadataCheck.ok) {
      await recordRejected(db, ctx.organizationId, bookingId, "imaging_manual_link_rejected", metadataCheck.reason, member.email);
      return Response.json({
        ok:false,
        status:"metadata_mismatch",
        reason:metadataCheck.reason,
        expected:{ modality:expectedModality, date:expectedDate },
      }, { status:409 });
    }

    const identityCheck = await checkPacsPatientIdentity(db, ctx.organizationId, booking, match);
    if (!identityCheck.ok) {
      await recordRejected(db, ctx.organizationId, bookingId, "imaging_manual_link_rejected", identityCheck.reason, member.email);
      return Response.json({ ok:false, status:"identity_mismatch", reason:identityCheck.reason }, { status:409 });
    }

    const seriesResult = await querySeries(pacs, match.studyInstanceUid);
    seriesCount = seriesResult.series.length || match.seriesCount;
    instancesCount = seriesResult.series.length
      ? seriesResult.series.reduce((sum, item) => sum + item.instances, 0)
      : match.instancesCount;
    accessionNumber = match.accessionNumber;
    studyInstanceUid = match.studyInstanceUid;
    modality = match.modality;
    studyDatetime = match.studyDatetime;
    studyStatus = study.studyStatus === "archived" ? "archived" : "available";
    source = "qido_uid_manual";
  }

  try {
    await db.prepare(
    `INSERT INTO imaging_studies
       (organization_id, booking_id, accession_number, study_instance_uid, modality,
        series_count, instances_count, study_status, study_datetime, source, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(booking_id) DO UPDATE SET
       organization_id = excluded.organization_id,
       accession_number = excluded.accession_number,
       study_instance_uid = excluded.study_instance_uid,
       modality = excluded.modality,
       series_count = excluded.series_count,
       instances_count = excluded.instances_count,
       study_status = excluded.study_status,
       study_datetime = excluded.study_datetime,
       source = excluded.source,
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    ctx.organizationId, bookingId, accessionNumber, studyInstanceUid, modality,
    seriesCount, instancesCount, studyStatus, studyDatetime, source, member.email,
    ).run();
  } catch (error) {
  if (!isSignedImagingIdentityLock(error)) throw error;
  await recordRejected(db, ctx.organizationId, bookingId, "imaging_relink_rejected", "signed_protocol_identity_locked", member.email);
  return Response.json({
    ok:false,
    status:"locked",
    reason:"signed_protocol_identity_locked",
  }, { status:409 });
}

  await db.prepare(
    "INSERT INTO booking_events (organization_id, booking_id, action, details, actor) VALUES (?, ?, 'imaging_linked', ?, ?)"
  ).bind(
    ctx.organizationId,
    bookingId,
    studyInstanceUid ? `${studyStatus} · PACS verified` : `${studyStatus} · manual metadata`,
    member.email,
  ).run();

  return Response.json({
    ok:true,
    study:{
      bookingId,
      accessionNumber,
      studyInstanceUid,
      modality,
      seriesCount,
      instancesCount,
      studyStatus,
      studyDatetime,
      source,
    },
  });
}
