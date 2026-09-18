import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";
import type { AccessRole } from "../../../../../lib/staff-auth";

const DECISIONS = new Set(["fit", "temporarily_unfit", "unfit", "other"]);

function canManagePersonnelVlk(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function clean(value: unknown, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function requireVlkManager(request: Request, db: D1Database) {
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManagePersonnelVlk(ctx.member.role)) return null;
  return ctx;
}

async function personnelInOrganization(db: D1Database, organizationId: number, personnelId: string) {
  return db.prepare(
    `SELECT id, display_name AS displayName, position_title AS positionTitle,
       department_id AS departmentId
     FROM personnel_records
     WHERE id = ? AND organization_id = ? LIMIT 1`,
  ).bind(personnelId, organizationId).first<{
    id: string;
    displayName: string;
    positionTitle: string;
    departmentId: number | null;
  }>();
}

type VlkInput = {
  personnelId?: string;
  examinationDate?: string;
  decisionCode?: string;
  decisionText?: string;
  validUntil?: string;
  commissionName?: string;
  documentNumber?: string;
  supersedesId?: string | null;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireVlkManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до даних ВЛК заборонено" }, { status: 403 });

  const personnelId = clean(new URL(request.url).searchParams.get("personnelId"), 120);
  if (!personnelId) return Response.json({ error: "Не вказано працівника" }, { status: 400 });

  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error: "Працівника не знайдено" }, { status: 404 });

  const records = await db.prepare(
    `SELECT r.id, r.personnel_id AS personnelId,
       r.examination_date AS examinationDate, r.decision_code AS decisionCode,
       r.decision_text AS decisionText, r.valid_until AS validUntil,
       r.commission_name AS commissionName, r.document_number AS documentNumber,
       r.supersedes_id AS supersedesId, r.created_by AS createdBy,
       r.created_at AS createdAt,
       CASE WHEN EXISTS (
         SELECT 1 FROM personnel_vlk_records correction
         WHERE correction.supersedes_id = r.id
           AND correction.organization_id = r.organization_id
           AND correction.personnel_id = r.personnel_id
       ) THEN 1 ELSE 0 END AS superseded
     FROM personnel_vlk_records r
     WHERE r.organization_id = ? AND r.personnel_id = ?
     ORDER BY r.examination_date DESC, r.created_at DESC, r.id DESC`,
  ).bind(ctx.organizationId, personnelId).all();

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_vlk_viewed",
    resource: "personnel_vlk",
    targetId: personnelId,
    details: { recordCount: records.results.length },
  });

  return Response.json(
    { personnel, records: records.results },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireVlkManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до даних ВЛК заборонено" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as VlkInput;
  const personnelId = clean(body.personnelId, 120);
  const examinationDate = clean(body.examinationDate, 10);
  const decisionCode = clean(body.decisionCode, 32);
  const decisionText = clean(body.decisionText, 240);
  const validUntil = clean(body.validUntil, 10);
  const commissionName = clean(body.commissionName, 200);
  const documentNumber = clean(body.documentNumber, 120);
  const supersedesId = clean(body.supersedesId, 120) || null;

  if (!personnelId || !validDate(examinationDate)) {
    return Response.json({ error: "Вкажіть працівника та дату ВЛК" }, { status: 400 });
  }
  if (!DECISIONS.has(decisionCode)) {
    return Response.json({ error: "Некоректне рішення ВЛК" }, { status: 400 });
  }
  if (decisionCode === "other" && !decisionText) {
    return Response.json({ error: "Для іншого рішення вкажіть текст висновку" }, { status: 400 });
  }
  if (validUntil && (!validDate(validUntil) || validUntil < examinationDate)) {
    return Response.json({ error: "Перевірте строк дії рішення ВЛК" }, { status: 400 });
  }

  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error: "Працівника не знайдено" }, { status: 404 });

  if (supersedesId) {
    const previous = await db.prepare(
      `SELECT previous.id,
         EXISTS(SELECT 1 FROM personnel_vlk_records next WHERE next.supersedes_id = previous.id) AS superseded
       FROM personnel_vlk_records previous
       WHERE previous.id = ? AND previous.organization_id = ? AND previous.personnel_id = ?
       LIMIT 1`,
    ).bind(supersedesId, ctx.organizationId, personnelId).first<{ id:string; superseded:number }>();
    if (!previous) return Response.json({ error: "Запис ВЛК для виправлення не знайдено" }, { status: 404 });
    if (previous.superseded) return Response.json({ error: "Цей запис ВЛК уже має виправлення" }, { status: 409 });
  }

  const id = `vlk-${crypto.randomUUID()}`;
  try {
    await db.prepare(
      `INSERT INTO personnel_vlk_records
       (id, organization_id, personnel_id, examination_date, decision_code,
        decision_text, valid_until, commission_name, document_number,
        supersedes_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, ctx.organizationId, personnelId, examinationDate, decisionCode,
      decisionText, validUntil, commissionName, documentNumber,
      supersedesId, ctx.member.email,
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/personnel_vlk_(personnel|supersedes)_scope/i.test(message)) {
      return Response.json({ error: "Посилання ВЛК не належить цій організації" }, { status: 409 });
    }
    if (/UNIQUE constraint failed: personnel_vlk_records\.supersedes_id/i.test(message)) {
      return Response.json({ error: "Цей запис ВЛК уже має виправлення" }, { status: 409 });
    }
    throw error;
  }

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_vlk_recorded",
    resource: "personnel_vlk",
    targetId: personnelId,
    details: { corrected: Boolean(supersedesId), recordId: id },
  });

  return Response.json({ ok: true, id }, { status: 201 });
}
