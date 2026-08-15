import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { canAccessBooking, canManageProtocols, canSignProtocols } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

const ADDENDUM_ID_RE = /^[0-9a-f]{32}$/;
const STATUSES = new Set(["draft", "ready", "signed", "issued"]);

type AddendumRow = {
  id:string; bookingId:number; baseProtocolVersion:number; reason:string; correctionText:string;
  status:string; version:number; authorEmail:string; updatedBy:string; updatedAt:string;
  signedBy:string; signedAt:string; signedVersion:number; createdAt:string;
};

function cleanText(value:unknown, max:number):string {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function parseDocument(body:Record<string, unknown>) {
  const reason = cleanText(body.reason, 500);
  const correctionText = cleanText(body.correctionText, 12000);
  const status = String(body.status || "draft");
  if (!reason) return { ok:false as const, error:"Вкажіть причину виправлення або доповнення" };
  if (!correctionText) return { ok:false as const, error:"Вкажіть текст виправлення або доповнення" };
  if (!STATUSES.has(status)) return { ok:false as const, error:"Некоректний статус виправлення" };
  return { ok:true as const, reason, correctionText, status };
}

const SELECT_COLUMNS = `id, booking_id AS bookingId, base_protocol_version AS baseProtocolVersion,
  reason, correction_text AS correctionText, status, version,
  author_email AS authorEmail, updated_by AS updatedBy, updated_at AS updatedAt,
  signed_by AS signedBy, signed_at AS signedAt, signed_version AS signedVersion,
  created_at AS createdAt`;

async function loadAddendum(db:D1Database, organizationId:number, id:string) {
  return db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM protocol_addenda WHERE organization_id = ? AND id = ? LIMIT 1`,
  ).bind(organizationId, id).first<AddendumRow>();
}

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  const member = ctx.member;
  if (!canManageProtocols(member.role)) return Response.json({ error:"Виправлення доступні лише лікарю або адміністратору" }, { status:403 });

  const bookingId = Number(new URL(request.url).searchParams.get("bookingId"));
  if (!Number.isInteger(bookingId) || bookingId <= 0) return Response.json({ error:"Некоректна заявка" }, { status:400 });
  if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
    return Response.json({ error:"Заявку не знайдено або її не призначено вам" }, { status:404 });
  }

  const [base, rows] = await Promise.all([
    db.prepare(
      `SELECT version, number, status FROM protocols
       WHERE organization_id = ? AND booking_id = ? LIMIT 1`,
    ).bind(ctx.organizationId, bookingId).first<Record<string, unknown>>(),
    db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM protocol_addenda
       WHERE organization_id = ? AND booking_id = ? ORDER BY created_at, id`,
    ).bind(ctx.organizationId, bookingId).all<AddendumRow>(),
  ]);
  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:member.email,
    action:"protocol_addenda_viewed", resource:"protocol_addendum", targetId:bookingId,
  });
  return Response.json({ baseProtocol:base || null, addenda:rows.results || [] }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  const member = ctx.member;
  if (!canManageProtocols(member.role)) return Response.json({ error:"Виправлення може створити лише лікар або адміністратор" }, { status:403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return Response.json({ error:"Некоректна заявка" }, { status:400 });
  if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
    return Response.json({ error:"Заявку не знайдено або її не призначено вам" }, { status:404 });
  }
  const parsed = parseDocument({ ...body, status:"draft" });
  if (!parsed.ok) return Response.json({ error:parsed.error }, { status:400 });

  const base = await db.prepare(
    `SELECT version FROM protocols WHERE organization_id = ? AND booking_id = ? AND status = 'issued' LIMIT 1`,
  ).bind(ctx.organizationId, bookingId).first<{ version:number }>();
  if (!base) return Response.json({ error:"Виправлення можна створити лише до вже виданого протоколу" }, { status:409 });

  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO protocol_addenda
          (id, organization_id, booking_id, base_protocol_version, reason, correction_text,
           status, version, author_email, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?)`,
      ).bind(id, ctx.organizationId, bookingId, base.version, parsed.reason, parsed.correctionText, member.email, member.email),
      db.prepare(
        `INSERT INTO protocol_addendum_revisions
          (addendum_id, organization_id, booking_id, base_protocol_version, version,
           reason, correction_text, status, saved_by)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'draft', ?)`,
      ).bind(id, ctx.organizationId, bookingId, base.version, parsed.reason, parsed.correctionText, member.email),
      db.prepare(
        `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
         VALUES (?, ?, 'protocol_addendum_created', ?, ?)`,
      ).bind(ctx.organizationId, bookingId, `addendum ${id} · base v${base.version}`, member.email),
    ]);
  } catch {
    return Response.json({ error:"Не вдалося створити виправлення. Оновіть сторінку." }, { status:409 });
  }
  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:member.email,
    action:"protocol_addendum_created", resource:"protocol_addendum", targetId:id,
    details:{ bookingId, baseProtocolVersion:base.version },
  });
  return Response.json({ ok:true, addendum:await loadAddendum(db, ctx.organizationId, id) }, { status:201 });
}

export async function PUT(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  const member = ctx.member;
  if (!canManageProtocols(member.role)) return Response.json({ error:"Виправлення може змінювати лише лікар або адміністратор" }, { status:403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = String(body.id || "").trim().toLowerCase();
  if (!ADDENDUM_ID_RE.test(id)) return Response.json({ error:"Некоректне виправлення" }, { status:400 });
  const existing = await loadAddendum(db, ctx.organizationId, id);
  if (!existing) return Response.json({ error:"Виправлення не знайдено" }, { status:404 });
  if (!await canAccessBooking(db, member, existing.bookingId, ctx.organizationId)) {
    return Response.json({ error:"Виправлення не знайдено або дослідження не призначено вам" }, { status:404 });
  }
  const baseVersion = Number(body.baseVersion);
  if (!Number.isInteger(baseVersion) || baseVersion !== Number(existing.version)) {
    return Response.json({ error:"Виправлення вже змінено в іншому вікні. Оновіть сторінку." }, { status:409 });
  }
  const parsed = parseDocument(body);
  if (!parsed.ok) return Response.json({ error:parsed.error }, { status:400 });
  if (existing.status === "issued") return Response.json({ error:"Видане виправлення незмінне" }, { status:409 });

  if (parsed.status === "issued") {
    if (existing.status !== "signed") return Response.json({ error:"Перед видачею виправлення має бути підписане лікарем-рентгенологом" }, { status:409 });
    if (parsed.reason !== existing.reason || parsed.correctionText !== existing.correctionText) {
      return Response.json({ error:"Підписане виправлення незмінне. Оновіть сторінку." }, { status:409 });
    }
    const result = await db.prepare(
      `UPDATE protocol_addenda SET status = 'issued', updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ? AND status = 'signed' AND version = ?`,
    ).bind(member.email, id, ctx.organizationId, existing.version).run().catch(() => null);
    if (!result?.meta.changes) return Response.json({ error:"Статус виправлення змінився. Оновіть сторінку." }, { status:409 });
    await audit(db, {
      organizationId:ctx.organizationId, actorEmail:member.email,
      action:"protocol_addendum_issued", resource:"protocol_addendum", targetId:id,
      details:{ bookingId:existing.bookingId, version:existing.version, baseProtocolVersion:existing.baseProtocolVersion },
    });
    return Response.json({ ok:true, addendum:await loadAddendum(db, ctx.organizationId, id) });
  }

  if (existing.status === "signed") return Response.json({ error:"Підписане виправлення незмінне. Доступна лише видача пацієнту." }, { status:409 });
  const allowed:Record<string, string[]> = { draft:["draft", "ready"], ready:["ready", "signed"] };
  if (!(allowed[existing.status] || []).includes(parsed.status)) return Response.json({ error:"Недопустимий перехід статусу виправлення" }, { status:409 });
  if (parsed.status === "signed" && !canSignProtocols(member.role)) {
    return Response.json({ error:"Підписати виправлення може лише лікар-рентгенолог" }, { status:403 });
  }

  const nextVersion = existing.version + 1;
  const signedAtRow = parsed.status === "signed"
    ? await db.prepare("SELECT CURRENT_TIMESTAMP AS now").first<{ now:string }>()
    : null;
  const signedBy = parsed.status === "signed" ? member.email : "";
  const signedAt = signedAtRow?.now || "";
  const signedVersion = parsed.status === "signed" ? nextVersion : 0;
  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE protocol_addenda SET reason = ?, correction_text = ?, status = ?, version = ?,
           updated_by = ?, updated_at = CURRENT_TIMESTAMP, signed_by = ?, signed_at = ?, signed_version = ?
         WHERE id = ? AND organization_id = ? AND version = ? AND status = ?`,
      ).bind(parsed.reason, parsed.correctionText, parsed.status, nextVersion, member.email,
        signedBy, signedAt, signedVersion, id, ctx.organizationId, existing.version, existing.status),
      db.prepare(
        `INSERT INTO protocol_addendum_revisions
          (addendum_id, organization_id, booking_id, base_protocol_version, version,
           reason, correction_text, status, saved_by)
         SELECT id, organization_id, booking_id, base_protocol_version, version,
           reason, correction_text, status, ? FROM protocol_addenda
         WHERE id = ? AND organization_id = ? AND version = ?`,
      ).bind(member.email, id, ctx.organizationId, nextVersion),
      db.prepare(
        `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
         SELECT organization_id, booking_id, 'protocol_addendum_saved', ?, ?
         FROM protocol_addenda WHERE id = ? AND organization_id = ? AND version = ?`,
      ).bind(`${parsed.status} · addendum ${id} · v${nextVersion}`, member.email, id, ctx.organizationId, nextVersion),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      return Response.json({ error:"Конфлікт версій виправлення. Оновіть сторінку." }, { status:409 });
    }
  } catch {
    return Response.json({ error:"Конфлікт версій або стану виправлення. Оновіть сторінку." }, { status:409 });
  }
  await audit(db, {
    organizationId:ctx.organizationId, actorEmail:member.email,
    action:parsed.status === "signed" ? "protocol_addendum_signed" : "protocol_addendum_saved",
    resource:"protocol_addendum", targetId:id,
    details:{ bookingId:existing.bookingId, version:nextVersion, status:parsed.status, baseProtocolVersion:existing.baseProtocolVersion },
  });
  return Response.json({ ok:true, addendum:await loadAddendum(db, ctx.organizationId, id) });
}
