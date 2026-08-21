import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import type { AccessRole } from "../../../../../lib/staff-auth";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";

function canViewPolicy(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function canManagePolicy(role: AccessRole) {
  return role === "admin";
}

function clean(value: unknown, max = 320) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function optionalPositiveDays(value: unknown): number | null | typeof NaN {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 36500 ? parsed : NaN;
}

type PolicyInput = {
  effectiveFrom?: string;
  enabled?: boolean;
  requireClearanceValidUntil?: boolean;
  trainingMaxAgeDays?: number | string | null;
  knowledgeCheckMaxAgeDays?: number | string | null;
  dosimetryMaxAgeDays?: number | string | null;
  sourceTitle?: string;
  sourceReference?: string;
  note?: string;
  supersedesId?: string | null;
};

type PolicyRow = {
  id:string;
  organizationId:number;
  effectiveFrom:string;
  enabled:number;
  requireClearanceValidUntil:number;
  trainingMaxAgeDays:number | null;
  knowledgeCheckMaxAgeDays:number | null;
  dosimetryMaxAgeDays:number | null;
  sourceTitle:string;
  sourceReference:string;
  note:string;
  supersedesId:string | null;
  createdBy:string;
  createdAt:string;
  superseded:number;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });

  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canViewPolicy(ctx.member.role)) {
    return Response.json({ error:"Доступ до політики радіаційного контролю заборонено" }, { status:403 });
  }

  const rows = await db.prepare(
    `SELECT r.id, r.organization_id AS organizationId,
       r.effective_from AS effectiveFrom, r.enabled,
       r.require_clearance_valid_until AS requireClearanceValidUntil,
       r.training_max_age_days AS trainingMaxAgeDays,
       r.knowledge_check_max_age_days AS knowledgeCheckMaxAgeDays,
       r.dosimetry_max_age_days AS dosimetryMaxAgeDays,
       r.source_title AS sourceTitle, r.source_reference AS sourceReference,
       r.note, r.supersedes_id AS supersedesId,
       r.created_by AS createdBy, r.created_at AS createdAt,
       CASE WHEN EXISTS (
         SELECT 1 FROM personnel_radiation_review_policy_revisions next
         WHERE next.supersedes_id = r.id
           AND next.organization_id = r.organization_id
       ) THEN 1 ELSE 0 END AS superseded
     FROM personnel_radiation_review_policy_revisions r
     WHERE r.organization_id = ?
     ORDER BY r.effective_from DESC, r.created_at DESC, r.id DESC`,
  ).bind(ctx.organizationId).all<PolicyRow>();

  const currentLeaf = rows.results.find((row) => !row.superseded) || null;

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_radiation_review_policy_viewed",
    resource:"personnel_radiation_review_policy",
    details:{ revisionCount:rows.results.length },
  });

  return Response.json({
    revisions:rows.results,
    currentLeaf,
    canManage:canManagePolicy(ctx.member.role),
  }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });

  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManagePolicy(ctx.member.role)) {
    return Response.json({ error:"Змінювати політику радіаційного контролю може лише адміністратор" }, { status:403 });
  }

  const body = await request.json().catch(() => ({})) as PolicyInput;
  const effectiveFrom = clean(body.effectiveFrom, 10);
  const enabled = body.enabled === true;
  const requireClearanceValidUntil = body.requireClearanceValidUntil === true;
  const trainingMaxAgeDays = optionalPositiveDays(body.trainingMaxAgeDays);
  const knowledgeCheckMaxAgeDays = optionalPositiveDays(body.knowledgeCheckMaxAgeDays);
  const dosimetryMaxAgeDays = optionalPositiveDays(body.dosimetryMaxAgeDays);
  const sourceTitle = clean(body.sourceTitle, 240);
  const sourceReference = clean(body.sourceReference, 500);
  const note = clean(body.note, 1000);
  const supersedesId = clean(body.supersedesId, 120) || null;

  if (!validIsoDate(effectiveFrom)) {
    return Response.json({ error:"Дата набрання чинності має бути у форматі РРРР-ММ-ДД" }, { status:400 });
  }
  if ([trainingMaxAgeDays, knowledgeCheckMaxAgeDays, dosimetryMaxAgeDays].some(Number.isNaN)) {
    return Response.json({ error:"Строки review мають бути цілими числами від 1 до 36500 днів або порожніми" }, { status:400 });
  }
  const hasCriterion = requireClearanceValidUntil
    || trainingMaxAgeDays != null
    || knowledgeCheckMaxAgeDays != null
    || dosimetryMaxAgeDays != null;
  if (enabled && !hasCriterion) {
    return Response.json({ error:"Для увімкненої політики налаштуйте хоча б один критерій review" }, { status:400 });
  }
  if (enabled && !sourceTitle) {
    return Response.json({ error:"Для увімкненої політики вкажіть назву джерела або внутрішнього документа" }, { status:400 });
  }

  const existing = await db.prepare(
    `SELECT r.id, r.effective_from AS effectiveFrom
     FROM personnel_radiation_review_policy_revisions r
     WHERE r.organization_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM personnel_radiation_review_policy_revisions next
         WHERE next.supersedes_id = r.id
           AND next.organization_id = r.organization_id
       )
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 2`,
  ).bind(ctx.organizationId).all<{ id:string; effectiveFrom:string }>();

  if (existing.results.length > 1) {
    return Response.json({ error:"Історія політики має кілька активних гілок; потрібна ручна перевірка" }, { status:409 });
  }
  const currentLeaf = existing.results[0] || null;
  if (!currentLeaf && supersedesId) {
    return Response.json({ error:"Першу ревізію політики не можна прив’язати до неіснуючого попереднього запису" }, { status:409 });
  }
  if (currentLeaf && supersedesId !== currentLeaf.id) {
    return Response.json({ error:"Нова ревізія має замінювати поточну останню версію політики" }, { status:409 });
  }
  if (currentLeaf && effectiveFrom < currentLeaf.effectiveFrom) {
    return Response.json({ error:"Нова ревізія не може набирати чинності раніше за попередню" }, { status:400 });
  }

  const id = `radiation-review-policy-${crypto.randomUUID()}`;
  try {
    await db.prepare(
      `INSERT INTO personnel_radiation_review_policy_revisions
       (id, organization_id, effective_from, enabled,
        require_clearance_valid_until, training_max_age_days,
        knowledge_check_max_age_days, dosimetry_max_age_days,
        source_title, source_reference, note, supersedes_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, ctx.organizationId, effectiveFrom, enabled ? 1 : 0,
      requireClearanceValidUntil ? 1 : 0,
      trainingMaxAgeDays, knowledgeCheckMaxAgeDays, dosimetryMaxAgeDays,
      sourceTitle, sourceReference, note, supersedesId, ctx.member.email,
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/personnel_radiation_review_policy_supersedes_scope/i.test(message)) {
      return Response.json({ error:"Попередня ревізія політики не належить цій організації" }, { status:409 });
    }
    if (/personnel_radiation_review_policy_effective_order/i.test(message)) {
      return Response.json({ error:"Нова ревізія не може набирати чинності раніше за попередню" }, { status:409 });
    }
    if (/personnel_radiation_review_policy_(one_root|supersedes_once)_idx|UNIQUE constraint failed/i.test(message)) {
      return Response.json({ error:"Історія політики вже змінилася; оновіть сторінку та повторіть" }, { status:409 });
    }
    throw error;
  }

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_radiation_review_policy_recorded",
    resource:"personnel_radiation_review_policy",
    targetId:id,
    details:{ enabled, supersedesId: supersedesId || "" },
  });

  return Response.json({ ok:true, id }, { status:201 });
}
