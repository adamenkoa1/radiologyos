import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { canManageProtocols } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

// Персональні текстові макроси лікаря (§7). Scoped до tenant + власника
// (owner_email). Це зручність авторства, не медичний документ: без клінічного
// lifecycle, без звʼязку з протоколом/пацієнтом. Доступ — ролі, що редагують
// протоколи (admin||radiologist); писати/видаляти можна лише власні макроси.

const TITLE_MAX = 120;
const BODY_MAX = 4000;

const SELECT = "id, title, body, created_at AS createdAt, updated_at AS updatedAt";

function normalizedText(value:unknown):string {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function parseMacro(body:Record<string, unknown>) {
  const title = normalizedText(body.title);
  const text = normalizedText(body.body);
  if (!title) return { ok:false as const, error:"Вкажіть назву макроса" };
  if (title.length > TITLE_MAX) return { ok:false as const, error:`Назва не може перевищувати ${TITLE_MAX} символів` };
  if (!text) return { ok:false as const, error:"Вкажіть текст макроса" };
  if (text.length > BODY_MAX) return { ok:false as const, error:`Текст макроса не може перевищувати ${BODY_MAX} символів` };
  return { ok:true as const, title, body:text };
}

async function guard(request:Request) {
  const db = dbBinding();
  if (!db) return { error:Response.json({ error:"База тимчасово недоступна" }, { status:503 }) };
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return { error:Response.json({ error:"Доступ лише для персоналу" }, { status:403 }) };
  if (!canManageProtocols(ctx.member.role)) {
    return { error:Response.json({ error:"Макроси доступні лікарю-рентгенологу або адміністратору" }, { status:403 }) };
  }
  return { db, ctx };
}

export async function GET(request:Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { db, ctx } = g;
  const rows = await db.prepare(
    `SELECT ${SELECT} FROM protocol_macros
     WHERE organization_id = ? AND owner_email = ? ORDER BY title`
  ).bind(ctx.organizationId, ctx.member.email).all();
  return Response.json({ macros:rows.results || [] }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request:Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { db, ctx } = g;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = parseMacro(body);
  if (!parsed.ok) return Response.json({ error:parsed.error }, { status:400 });

  const inserted = await db.prepare(
    `INSERT INTO protocol_macros (organization_id, owner_email, title, body)
     VALUES (?, ?, ?, ?) RETURNING ${SELECT}`
  ).bind(ctx.organizationId, ctx.member.email, parsed.title, parsed.body).first<Record<string, unknown>>();

  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:ctx.member.email,
    action:"protocol_macro_created", resource:"protocol_macro",
    targetId:String(inserted?.id ?? ""), details:{ title:parsed.title },
  });
  return Response.json({ ok:true, macro:inserted }, { status:201, headers:{ "cache-control":"no-store" } });
}

export async function PATCH(request:Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { db, ctx } = g;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error:"Некоректний макрос" }, { status:400 });
  const parsed = parseMacro(body);
  if (!parsed.ok) return Response.json({ error:parsed.error }, { status:400 });

  // Оновлюємо лише ВЛАСНИЙ макрос у цьому tenant.
  const result = await db.prepare(
    `UPDATE protocol_macros SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND organization_id = ? AND owner_email = ?`
  ).bind(parsed.title, parsed.body, id, ctx.organizationId, ctx.member.email).run();
  if (!result.meta || result.meta.changes !== 1) {
    return Response.json({ error:"Макрос не знайдено" }, { status:404 });
  }
  const row = await db.prepare(
    `SELECT ${SELECT} FROM protocol_macros WHERE id = ? AND organization_id = ? AND owner_email = ?`
  ).bind(id, ctx.organizationId, ctx.member.email).first<Record<string, unknown>>();
  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:ctx.member.email,
    action:"protocol_macro_updated", resource:"protocol_macro",
    targetId:String(id), details:{ title:parsed.title },
  });
  return Response.json({ ok:true, macro:row }, { headers:{ "cache-control":"no-store" } });
}

export async function DELETE(request:Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { db, ctx } = g;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error:"Некоректний макрос" }, { status:400 });
  const result = await db.prepare(
    `DELETE FROM protocol_macros WHERE id = ? AND organization_id = ? AND owner_email = ?`
  ).bind(id, ctx.organizationId, ctx.member.email).run();
  if (!result.meta || result.meta.changes !== 1) {
    return Response.json({ error:"Макрос не знайдено" }, { status:404 });
  }
  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:ctx.member.email,
    action:"protocol_macro_deleted", resource:"protocol_macro",
    targetId:String(id), details:{},
  });
  return Response.json({ ok:true }, { headers:{ "cache-control":"no-store" } });
}
