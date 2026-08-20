import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";
import type { AccessRole } from "../../../../../lib/staff-auth";

const DECISIONS = new Set(["authorized", "suspended", "revoked", "other"]);

function canManageRadiationClearance(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function clean(value: unknown, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function requireClearanceManager(request: Request, db: D1Database) {
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManageRadiationClearance(ctx.member.role)) return null;
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

type ClearanceInput = {
  personnelId?: string;
  effectiveDate?: string;
  decisionCode?: string;
  scopeText?: string;
  validUntil?: string;
  documentType?: string;
  documentNumber?: string;
  documentDate?: string;
  issuedBy?: string;
  note?: string;
  supersedesId?: string | null;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireClearanceManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до реєстру допусків до ДІВ заборонено" }, { status: 403 });

  const personnelId = clean(new URL(request.url).searchParams.get("personnelId"), 120);
  if (!personnelId) return Response.json({ error: "Не вказано працівника" }, { status: 400 });

  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error: "Працівника не знайдено" }, { status: 404 });

  const records = await db.prepare(
    `SELECT r.id, r.personnel_id AS personnelId,
       r.effective_date AS effectiveDate, r.decision_code AS decisionCode,
       r.scope_text AS scopeText, r.valid_until AS validUntil,
       r.document_type AS documentType, r.document_number AS documentNumber,
       r.document_date AS documentDate, r.issued_by AS issuedBy,
       r.note, r.supersedes_id AS supersedesId,
       r.created_by AS createdBy, r.created_at AS createdAt,
       CASE WHEN EXISTS (
         SELECT 1 FROM personnel_radiation_clearance_records correction
         WHERE correction.supersedes_id = r.id
           AND correction.organization_id = r.organization_id
           AND correction.personnel_id = r.personnel_id
       ) THEN 1 ELSE 0 END AS superseded
     FROM personnel_radiation_clearance_records r
     WHERE r.organization_id = ? AND r.personnel_id = ?
     ORDER BY r.effective_date DESC, r.created_at DESC, r.id DESC`,
  ).bind(ctx.organizationId, personnelId).all();

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_radiation_clearance_viewed",
    resource: "personnel_radiation_clearance",
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
  const ctx = await requireClearanceManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до реєстру допусків до ДІВ заборонено" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as ClearanceInput;
  const personnelId = clean(body.personnelId, 120);
  const effectiveDate = clean(body.effectiveDate, 10);
  const decisionCode = clean(body.decisionCode, 32);
  const scopeText = clean(body.scopeText, 400);
  const validUntil = clean(body.validUntil, 10);
  const documentType = clean(body.documentType, 120);
  const documentNumber = clean(body.documentNumber, 120);
  const documentDate = clean(body.documentDate, 10);
  const issuedBy = clean(body.issuedBy, 200);
  const note = clean(body.note, 400);
  const supersedesId = clean(body.supersedesId, 120) || null;

  if (!personnelId || !validDate(effectiveDate)) {
    return Response.json({ error: "Вкажіть працівника та дату набрання чинності" }, { status: 400 });
  }
  if (!DECISIONS.has(decisionCode)) {
    return Response.json({ error: "Некоректне рішення щодо допуску до ДІВ" }, { status: 400 });
  }
  if (decisionCode === "authorized" && !scopeText) {
    return Response.json({ error: "Для допуску вкажіть обсяг дозволених робіт" }, { status: 400 });
  }
  if (decisionCode === "other" && !note) {
    return Response.json({ error: "Для іншого рішення вкажіть примітку" }, { status: 400 });
  }
  if (validUntil && (!validDate(validUntil) || validUntil < effectiveDate)) {
    return Response.json({ error: "Перевірте строк дії допуску" }, { status: 400 });
  }
  if (documentDate && !validDate(documentDate)) {
    return Response.json({ error: "Перевірте дату документа" }, { status: 400 });
  }

  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error: "Працівника не знайдено" }, { status: 404 });

  if (supersedesId) {
    const previous = await db.prepare(
      `SELECT previous.id,
         EXISTS(
           SELECT 1 FROM personnel_radiation_clearance_records next
           WHERE next.supersedes_id = previous.id
         ) AS superseded
       FROM personnel_radiation_clearance_records previous
       WHERE previous.id = ? AND previous.organization_id = ? AND previous.personnel_id = ?
       LIMIT 1`,
    ).bind(supersedesId, ctx.organizationId, personnelId).first<{ id:string; superseded:number }>();
    if (!previous) return Response.json({ error: "Запис допуску для виправлення не знайдено" }, { status: 404 });
    if (previous.superseded) return Response.json({ error: "Цей запис допуску вже має виправлення" }, { status: 409 });
  }

  const id = `radiation-clearance-${crypto.randomUUID()}`;
  try {
    await db.prepare(
      `INSERT INTO personnel_radiation_clearance_records
       (id, organization_id, personnel_id, effective_date, decision_code,
        scope_text, valid_until, document_type, document_number, document_date,
        issued_by, note, supersedes_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, ctx.organizationId, personnelId, effectiveDate, decisionCode,
      scopeText, validUntil, documentType, documentNumber, documentDate,
      issuedBy, note, supersedesId, ctx.member.email,
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/personnel_radiation_clearance_(personnel|supersedes)_scope/i.test(message)) {
      return Response.json({ error: "Посилання допуску не належить цій організації" }, { status: 409 });
    }
    if (/UNIQUE constraint failed: personnel_radiation_clearance_records\.supersedes_id/i.test(message)) {
      return Response.json({ error: "Цей запис допуску вже має виправлення" }, { status: 409 });
    }
    throw error;
  }

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_radiation_clearance_recorded",
    resource: "personnel_radiation_clearance",
    targetId: personnelId,
    details: { corrected: Boolean(supersedesId), recordId: id },
  });

  return Response.json({ ok: true, id }, { status: 201 });
}
