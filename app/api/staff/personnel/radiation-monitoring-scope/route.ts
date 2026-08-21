import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import type { AccessRole } from "../../../../../lib/staff-auth";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";

const SCOPE_STATUSES = new Set(["in_scope", "out_of_scope", "other"]);

function canManageRadiationMonitoringScope(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function clean(value: unknown, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function requireScopeManager(request: Request, db: D1Database) {
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManageRadiationMonitoringScope(ctx.member.role)) return null;
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

type ScopeInput = {
  personnelId?:string;
  effectiveDate?:string;
  scopeStatus?:string;
  scopeText?:string;
  basisTitle?:string;
  basisReference?:string;
  note?:string;
  supersedesId?:string | null;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireScopeManager(request, db);
  if (!ctx) return Response.json({ error:"Доступ до контуру радіаційного контролю заборонено" }, { status:403 });

  const personnelId = clean(new URL(request.url).searchParams.get("personnelId"), 120);
  if (!personnelId) return Response.json({ error:"Не вказано працівника" }, { status:400 });
  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error:"Працівника не знайдено" }, { status:404 });

  const records = await db.prepare(
    `SELECT r.id, r.personnel_id AS personnelId,
       r.effective_date AS effectiveDate, r.scope_status AS scopeStatus,
       r.scope_text AS scopeText, r.basis_title AS basisTitle,
       r.basis_reference AS basisReference, r.note,
       r.supersedes_id AS supersedesId, r.created_by AS createdBy,
       r.created_at AS createdAt,
       CASE WHEN EXISTS (
         SELECT 1 FROM personnel_radiation_monitoring_scope_records correction
         WHERE correction.supersedes_id = r.id
           AND correction.organization_id = r.organization_id
           AND correction.personnel_id = r.personnel_id
       ) THEN 1 ELSE 0 END AS superseded
     FROM personnel_radiation_monitoring_scope_records r
     WHERE r.organization_id = ? AND r.personnel_id = ?
     ORDER BY r.effective_date DESC, r.created_at DESC, r.id DESC`,
  ).bind(ctx.organizationId, personnelId).all();

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_radiation_monitoring_scope_viewed",
    resource:"personnel_radiation_monitoring_scope",
    targetId:personnelId,
    details:{ recordCount:records.results.length },
  });

  return Response.json({ personnel, records:records.results }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireScopeManager(request, db);
  if (!ctx) return Response.json({ error:"Доступ до контуру радіаційного контролю заборонено" }, { status:403 });

  const body = await request.json().catch(() => ({})) as ScopeInput;
  const personnelId = clean(body.personnelId, 120);
  const effectiveDate = clean(body.effectiveDate, 10);
  const scopeStatus = clean(body.scopeStatus, 32);
  const scopeText = clean(body.scopeText, 500);
  const basisTitle = clean(body.basisTitle, 240);
  const basisReference = clean(body.basisReference, 500);
  const note = clean(body.note, 500);
  const supersedesId = clean(body.supersedesId, 120) || null;

  if (!personnelId || !validDate(effectiveDate)) {
    return Response.json({ error:"Вкажіть працівника та дату набрання чинності" }, { status:400 });
  }
  if (!SCOPE_STATUSES.has(scopeStatus)) {
    return Response.json({ error:"Некоректний статус контуру радіаційного контролю" }, { status:400 });
  }
  if (scopeStatus === "in_scope" && !scopeText) {
    return Response.json({ error:"Для включення в контур вкажіть організаційний обсяг контролю" }, { status:400 });
  }
  if (scopeStatus === "other" && !note) {
    return Response.json({ error:"Для іншого статусу вкажіть примітку" }, { status:400 });
  }

  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error:"Працівника не знайдено" }, { status:404 });

  if (supersedesId) {
    const previous = await db.prepare(
      `SELECT previous.id,
         EXISTS(
           SELECT 1 FROM personnel_radiation_monitoring_scope_records next
           WHERE next.supersedes_id = previous.id
         ) AS superseded
       FROM personnel_radiation_monitoring_scope_records previous
       WHERE previous.id = ? AND previous.organization_id = ? AND previous.personnel_id = ?
       LIMIT 1`,
    ).bind(supersedesId, ctx.organizationId, personnelId).first<{ id:string; superseded:number }>();
    if (!previous) return Response.json({ error:"Запис контуру для виправлення не знайдено" }, { status:404 });
    if (previous.superseded) return Response.json({ error:"Цей запис уже має виправлення" }, { status:409 });
  }

  const id = `radiation-monitoring-scope-${crypto.randomUUID()}`;
  try {
    await db.prepare(
      `INSERT INTO personnel_radiation_monitoring_scope_records
       (id, organization_id, personnel_id, effective_date, scope_status,
        scope_text, basis_title, basis_reference, note, supersedes_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, ctx.organizationId, personnelId, effectiveDate, scopeStatus,
      scopeText, basisTitle, basisReference, note, supersedesId, ctx.member.email,
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/personnel_radiation_monitoring_scope_(personnel|supersedes)_scope/i.test(message)) {
      return Response.json({ error:"Посилання контуру не належить цій організації" }, { status:409 });
    }
    if (/UNIQUE constraint failed: personnel_radiation_monitoring_scope_records\.supersedes_id/i.test(message)) {
      return Response.json({ error:"Цей запис уже має виправлення" }, { status:409 });
    }
    throw error;
  }

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_radiation_monitoring_scope_recorded",
    resource:"personnel_radiation_monitoring_scope",
    targetId:personnelId,
    details:{ corrected:Boolean(supersedesId), recordId:id },
  });

  return Response.json({ ok:true, id }, { status:201 });
}
