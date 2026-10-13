import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { isProtocolTemplate, sanitizeDocument } from "../../../../../lib/protocols";
import { canManageProtocols } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

// Персональні повні шаблони лікаря (§7, Этап D5c). Збережений заготовлений
// документ протоколу (без номера й статусу) на базі каталожного шаблону.
// Scoped до tenant + власника; зручність авторства, не медичний обʼєкт.
// Доступ — ролі, що редагують протоколи; писати/видаляти — лише власні.

const TITLE_MAX = 120;
const DOC_MAX = 40000;

const LIST_SELECT = "id, title, base_template_key AS baseTemplateKey, document_json AS documentJson, created_at AS createdAt, updated_at AS updatedAt";

function normalizedTitle(value:unknown):string {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

// Валідуємо вхідний документ тим самим санітайзером, що й протокол (статус
// примусово draft — шаблон не має статусу), і зберігаємо канонічний JSON.
function parseTemplate(body:Record<string, unknown>) {
  const title = normalizedTitle(body.title);
  if (!title) return { ok:false as const, error:"Вкажіть назву шаблону" };
  if (title.length > TITLE_MAX) return { ok:false as const, error:`Назва не може перевищувати ${TITLE_MAX} символів` };
  const baseTemplateKey = String(body.baseTemplateKey || "");
  if (!isProtocolTemplate(baseTemplateKey)) return { ok:false as const, error:"Невідомий базовий шаблон" };
  const sanitized = sanitizeDocument({ ...(body.document as object || {}), templateKey:baseTemplateKey, status:"draft", number:"" });
  if (!sanitized.ok) return { ok:false as const, error:sanitized.error };
  // Зберігаємо лише заготовчу частину (без номера/статусу — вони належать
  // конкретному протоколу, не шаблону).
  const d = sanitized.document;
  const documentJson = JSON.stringify({
    templateKey:d.templateKey, method:d.method, methodRef:d.methodRef, sections:d.sections,
    findings:d.findings, conclusion:d.conclusion, recommendations:d.recommendations,
  });
  if (documentJson.length > DOC_MAX) return { ok:false as const, error:"Шаблон завеликий" };
  return { ok:true as const, title, baseTemplateKey, documentJson };
}

async function guard(request:Request) {
  const db = dbBinding();
  if (!db) return { error:Response.json({ error:"База тимчасово недоступна" }, { status:503 }) };
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return { error:Response.json({ error:"Доступ лише для персоналу" }, { status:403 }) };
  if (!canManageProtocols(ctx.member.role)) {
    return { error:Response.json({ error:"Шаблони доступні лікарю-рентгенологу або адміністратору" }, { status:403 }) };
  }
  return { db, ctx };
}

export async function GET(request:Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { db, ctx } = g;
  const rows = await db.prepare(
    `SELECT ${LIST_SELECT} FROM protocol_user_templates
     WHERE organization_id = ? AND owner_email = ? ORDER BY title`
  ).bind(ctx.organizationId, ctx.member.email).all();
  return Response.json({ templates:rows.results || [] }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request:Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { db, ctx } = g;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = parseTemplate(body);
  if (!parsed.ok) return Response.json({ error:parsed.error }, { status:400 });
  const inserted = await db.prepare(
    `INSERT INTO protocol_user_templates (organization_id, owner_email, title, base_template_key, document_json)
     VALUES (?, ?, ?, ?, ?) RETURNING ${LIST_SELECT}`
  ).bind(ctx.organizationId, ctx.member.email, parsed.title, parsed.baseTemplateKey, parsed.documentJson).first<Record<string, unknown>>();
  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:ctx.member.email,
    action:"protocol_template_saved", resource:"protocol_user_template",
    targetId:String(inserted?.id ?? ""), details:{ title:parsed.title, baseTemplateKey:parsed.baseTemplateKey },
  });
  return Response.json({ ok:true, template:inserted }, { status:201, headers:{ "cache-control":"no-store" } });
}

export async function PATCH(request:Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { db, ctx } = g;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error:"Некоректний шаблон" }, { status:400 });
  const parsed = parseTemplate(body);
  if (!parsed.ok) return Response.json({ error:parsed.error }, { status:400 });
  const result = await db.prepare(
    `UPDATE protocol_user_templates SET title = ?, base_template_key = ?, document_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND organization_id = ? AND owner_email = ?`
  ).bind(parsed.title, parsed.baseTemplateKey, parsed.documentJson, id, ctx.organizationId, ctx.member.email).run();
  if (!result.meta || result.meta.changes !== 1) return Response.json({ error:"Шаблон не знайдено" }, { status:404 });
  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:ctx.member.email,
    action:"protocol_template_updated", resource:"protocol_user_template",
    targetId:String(id), details:{ title:parsed.title },
  });
  return Response.json({ ok:true }, { headers:{ "cache-control":"no-store" } });
}

export async function DELETE(request:Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { db, ctx } = g;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error:"Некоректний шаблон" }, { status:400 });
  const result = await db.prepare(
    `DELETE FROM protocol_user_templates WHERE id = ? AND organization_id = ? AND owner_email = ?`
  ).bind(id, ctx.organizationId, ctx.member.email).run();
  if (!result.meta || result.meta.changes !== 1) return Response.json({ error:"Шаблон не знайдено" }, { status:404 });
  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:ctx.member.email,
    action:"protocol_template_deleted", resource:"protocol_user_template",
    targetId:String(id), details:{},
  });
  return Response.json({ ok:true }, { headers:{ "cache-control":"no-store" } });
}
