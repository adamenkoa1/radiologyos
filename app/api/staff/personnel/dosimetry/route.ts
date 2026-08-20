import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";
import type { AccessRole } from "../../../../../lib/staff-auth";

const MEASUREMENT_STATUSES = new Set(["measured", "below_detection", "missing", "other"]);

function canManageDosimetry(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function clean(value: unknown, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function finiteDose(value: unknown) {
  const dose = Number(value ?? 0);
  return Number.isFinite(dose) && dose >= 0 && dose <= 100000 ? dose : NaN;
}

async function requireDosimetryManager(request: Request, db: D1Database) {
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManageDosimetry(ctx.member.role)) return null;
  return ctx;
}

async function personnelInOrganization(db: D1Database, organizationId: number, personnelId: string) {
  return db.prepare(
    `SELECT id, display_name AS displayName, position_title AS positionTitle,
       department_id AS departmentId
     FROM personnel_records
     WHERE id = ? AND organization_id = ? LIMIT 1`,
  ).bind(personnelId, organizationId).first<{
    id:string;
    displayName:string;
    positionTitle:string;
    departmentId:number | null;
  }>();
}

type DosimetryInput = {
  personnelId?:string;
  periodStart?:string;
  periodEnd?:string;
  measurementStatus?:string;
  dosimeterCode?:string;
  hp10Msv?:number | string;
  hp007Msv?:number | string;
  hp3Msv?:number | string;
  providerName?:string;
  reportNumber?:string;
  reportDate?:string;
  note?:string;
  supersedesId?:string | null;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireDosimetryManager(request, db);
  if (!ctx) return Response.json({ error:"Доступ до індивідуальної дозиметрії заборонено" }, { status:403 });

  const personnelId = clean(new URL(request.url).searchParams.get("personnelId"), 120);
  if (!personnelId) return Response.json({ error:"Не вказано працівника" }, { status:400 });
  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error:"Працівника не знайдено" }, { status:404 });

  const records = await db.prepare(
    `SELECT r.id, r.personnel_id AS personnelId,
       r.period_start AS periodStart, r.period_end AS periodEnd,
       r.measurement_status AS measurementStatus, r.dosimeter_code AS dosimeterCode,
       r.hp10_msv AS hp10Msv, r.hp007_msv AS hp007Msv, r.hp3_msv AS hp3Msv,
       r.provider_name AS providerName, r.report_number AS reportNumber,
       r.report_date AS reportDate, r.note, r.supersedes_id AS supersedesId,
       r.created_by AS createdBy, r.created_at AS createdAt,
       CASE WHEN EXISTS (
         SELECT 1 FROM personnel_dosimetry_records correction
         WHERE correction.supersedes_id = r.id
           AND correction.organization_id = r.organization_id
           AND correction.personnel_id = r.personnel_id
       ) THEN 1 ELSE 0 END AS superseded
     FROM personnel_dosimetry_records r
     WHERE r.organization_id = ? AND r.personnel_id = ?
     ORDER BY r.period_end DESC, r.period_start DESC, r.created_at DESC, r.id DESC`,
  ).bind(ctx.organizationId, personnelId).all();

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_dosimetry_viewed",
    resource:"personnel_dosimetry",
    targetId:personnelId,
    details:{ recordCount:records.results.length },
  });

  return Response.json({ personnel, records:records.results }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireDosimetryManager(request, db);
  if (!ctx) return Response.json({ error:"Доступ до індивідуальної дозиметрії заборонено" }, { status:403 });

  const body = await request.json().catch(() => ({})) as DosimetryInput;
  const personnelId = clean(body.personnelId, 120);
  const periodStart = clean(body.periodStart, 10);
  const periodEnd = clean(body.periodEnd, 10);
  const measurementStatus = clean(body.measurementStatus, 32);
  const dosimeterCode = clean(body.dosimeterCode, 120);
  const hp10Msv = finiteDose(body.hp10Msv);
  const hp007Msv = finiteDose(body.hp007Msv);
  const hp3Msv = finiteDose(body.hp3Msv);
  const providerName = clean(body.providerName, 200);
  const reportNumber = clean(body.reportNumber, 120);
  const reportDate = clean(body.reportDate, 10);
  const note = clean(body.note, 400);
  const supersedesId = clean(body.supersedesId, 120) || null;

  if (!personnelId || !validDate(periodStart) || !validDate(periodEnd) || periodEnd < periodStart) {
    return Response.json({ error:"Перевірте працівника та період дозиметрії" }, { status:400 });
  }
  if (!MEASUREMENT_STATUSES.has(measurementStatus)) {
    return Response.json({ error:"Некоректний статус дозиметрії" }, { status:400 });
  }
  if (![hp10Msv, hp007Msv, hp3Msv].every(Number.isFinite)) {
    return Response.json({ error:"Значення дози мають бути невід’ємними числами" }, { status:400 });
  }
  if (reportDate && !validDate(reportDate)) {
    return Response.json({ error:"Перевірте дату звіту" }, { status:400 });
  }
  if (measurementStatus === "other" && !note) {
    return Response.json({ error:"Для іншого статусу вкажіть примітку" }, { status:400 });
  }

  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error:"Працівника не знайдено" }, { status:404 });

  if (supersedesId) {
    const previous = await db.prepare(
      `SELECT previous.id,
         EXISTS(
           SELECT 1 FROM personnel_dosimetry_records next
           WHERE next.supersedes_id = previous.id
         ) AS superseded
       FROM personnel_dosimetry_records previous
       WHERE previous.id = ? AND previous.organization_id = ? AND previous.personnel_id = ?
       LIMIT 1`,
    ).bind(supersedesId, ctx.organizationId, personnelId).first<{ id:string; superseded:number }>();
    if (!previous) return Response.json({ error:"Запис дозиметрії для виправлення не знайдено" }, { status:404 });
    if (previous.superseded) return Response.json({ error:"Цей запис дозиметрії вже має виправлення" }, { status:409 });
  }

  const id = `dosimetry-${crypto.randomUUID()}`;
  try {
    await db.prepare(
      `INSERT INTO personnel_dosimetry_records
       (id, organization_id, personnel_id, period_start, period_end,
        measurement_status, dosimeter_code, hp10_msv, hp007_msv, hp3_msv,
        provider_name, report_number, report_date, note, supersedes_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, ctx.organizationId, personnelId, periodStart, periodEnd,
      measurementStatus, dosimeterCode, hp10Msv, hp007Msv, hp3Msv,
      providerName, reportNumber, reportDate, note, supersedesId, ctx.member.email,
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/personnel_dosimetry_(personnel|supersedes)_scope/i.test(message)) {
      return Response.json({ error:"Посилання дозиметрії не належить цій організації" }, { status:409 });
    }
    if (/UNIQUE constraint failed: personnel_dosimetry_records\.supersedes_id/i.test(message)) {
      return Response.json({ error:"Цей запис дозиметрії вже має виправлення" }, { status:409 });
    }
    throw error;
  }

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_dosimetry_recorded",
    resource:"personnel_dosimetry",
    targetId:personnelId,
    details:{ corrected:Boolean(supersedesId), recordId:id },
  });

  return Response.json({ ok:true, id }, { status:201 });
}
