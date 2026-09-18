import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";
import type { AccessRole } from "../../../../../lib/staff-auth";

const TRAINING_KINDS = new Set(["radiation_safety", "knowledge_check", "briefing", "other"]);
const RESULT_CODES = new Set(["completed", "passed", "failed", "other"]);

function canManageRadiationTraining(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function clean(value: unknown, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function requireTrainingManager(request: Request, db: D1Database) {
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManageRadiationTraining(ctx.member.role)) return null;
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

type TrainingInput = {
  personnelId?:string;
  trainingDate?:string;
  trainingKind?:string;
  resultCode?:string;
  courseTitle?:string;
  providerName?:string;
  trainingHours?:number | string;
  validUntil?:string;
  certificateNumber?:string;
  certificateDate?:string;
  note?:string;
  supersedesId?:string | null;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireTrainingManager(request, db);
  if (!ctx) return Response.json({ error:"Доступ до навчання з радіаційної безпеки заборонено" }, { status:403 });

  const personnelId = clean(new URL(request.url).searchParams.get("personnelId"), 120);
  if (!personnelId) return Response.json({ error:"Не вказано працівника" }, { status:400 });

  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error:"Працівника не знайдено" }, { status:404 });

  const records = await db.prepare(
    `SELECT r.id, r.personnel_id AS personnelId,
       r.training_date AS trainingDate, r.training_kind AS trainingKind,
       r.result_code AS resultCode, r.course_title AS courseTitle,
       r.provider_name AS providerName, r.training_hours AS trainingHours,
       r.valid_until AS validUntil, r.certificate_number AS certificateNumber,
       r.certificate_date AS certificateDate, r.note,
       r.supersedes_id AS supersedesId, r.created_by AS createdBy,
       r.created_at AS createdAt,
       CASE WHEN EXISTS (
         SELECT 1 FROM personnel_radiation_training_records correction
         WHERE correction.supersedes_id = r.id
           AND correction.organization_id = r.organization_id
           AND correction.personnel_id = r.personnel_id
       ) THEN 1 ELSE 0 END AS superseded
     FROM personnel_radiation_training_records r
     WHERE r.organization_id = ? AND r.personnel_id = ?
     ORDER BY r.training_date DESC, r.created_at DESC, r.id DESC`,
  ).bind(ctx.organizationId, personnelId).all();

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_radiation_training_viewed",
    resource:"personnel_radiation_training",
    targetId:personnelId,
    details:{ recordCount:records.results.length },
  });

  return Response.json({ personnel, records:records.results }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireTrainingManager(request, db);
  if (!ctx) return Response.json({ error:"Доступ до навчання з радіаційної безпеки заборонено" }, { status:403 });

  const body = await request.json().catch(() => ({})) as TrainingInput;
  const personnelId = clean(body.personnelId, 120);
  const trainingDate = clean(body.trainingDate, 10);
  const trainingKind = clean(body.trainingKind, 32);
  const resultCode = clean(body.resultCode, 24);
  const courseTitle = clean(body.courseTitle, 240);
  const providerName = clean(body.providerName, 200);
  const trainingHours = Number(body.trainingHours || 0);
  const validUntil = clean(body.validUntil, 10);
  const certificateNumber = clean(body.certificateNumber, 120);
  const certificateDate = clean(body.certificateDate, 10);
  const note = clean(body.note, 400);
  const supersedesId = clean(body.supersedesId, 120) || null;

  if (!personnelId || !validDate(trainingDate) || !courseTitle) {
    return Response.json({ error:"Вкажіть працівника, дату та назву навчання" }, { status:400 });
  }
  if (!TRAINING_KINDS.has(trainingKind)) {
    return Response.json({ error:"Некоректний вид навчання" }, { status:400 });
  }
  if (!RESULT_CODES.has(resultCode)) {
    return Response.json({ error:"Некоректний результат навчання" }, { status:400 });
  }
  if (!Number.isInteger(trainingHours) || trainingHours < 0 || trainingHours > 10000) {
    return Response.json({ error:"Перевірте кількість годин навчання" }, { status:400 });
  }
  if (validUntil && (!validDate(validUntil) || validUntil < trainingDate)) {
    return Response.json({ error:"Перевірте строк дії навчання" }, { status:400 });
  }
  if (certificateDate && !validDate(certificateDate)) {
    return Response.json({ error:"Перевірте дату сертифіката" }, { status:400 });
  }
  if (resultCode === "other" && !note) {
    return Response.json({ error:"Для іншого результату вкажіть примітку" }, { status:400 });
  }

  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error:"Працівника не знайдено" }, { status:404 });

  if (supersedesId) {
    const previous = await db.prepare(
      `SELECT previous.id,
         EXISTS(
           SELECT 1 FROM personnel_radiation_training_records next
           WHERE next.supersedes_id = previous.id
         ) AS superseded
       FROM personnel_radiation_training_records previous
       WHERE previous.id = ? AND previous.organization_id = ? AND previous.personnel_id = ?
       LIMIT 1`,
    ).bind(supersedesId, ctx.organizationId, personnelId).first<{ id:string; superseded:number }>();
    if (!previous) return Response.json({ error:"Запис навчання для виправлення не знайдено" }, { status:404 });
    if (previous.superseded) return Response.json({ error:"Цей запис навчання вже має виправлення" }, { status:409 });
  }

  const id = `radiation-training-${crypto.randomUUID()}`;
  try {
    await db.prepare(
      `INSERT INTO personnel_radiation_training_records
       (id, organization_id, personnel_id, training_date, training_kind,
        result_code, course_title, provider_name, training_hours, valid_until,
        certificate_number, certificate_date, note, supersedes_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, ctx.organizationId, personnelId, trainingDate, trainingKind,
      resultCode, courseTitle, providerName, trainingHours, validUntil,
      certificateNumber, certificateDate, note, supersedesId, ctx.member.email,
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/personnel_radiation_training_(personnel|supersedes)_scope/i.test(message)) {
      return Response.json({ error:"Посилання навчання не належить цій організації" }, { status:409 });
    }
    if (/UNIQUE constraint failed: personnel_radiation_training_records\.supersedes_id/i.test(message)) {
      return Response.json({ error:"Цей запис навчання вже має виправлення" }, { status:409 });
    }
    throw error;
  }

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_radiation_training_recorded",
    resource:"personnel_radiation_training",
    targetId:personnelId,
    details:{ corrected:Boolean(supersedesId), recordId:id },
  });

  return Response.json({ ok:true, id }, { status:201 });
}
