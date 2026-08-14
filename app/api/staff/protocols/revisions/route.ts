import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { canAccessBooking, canManageProtocols } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

function parseSections(value:string):Record<string, Record<string, string>> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, Record<string, string>>
      : {};
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });

  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  const member = ctx.member;
  if (!canManageProtocols(member.role)) {
    return Response.json({ error:"Історія протоколу доступна лише лікарю або адміністратору" }, { status:403 });
  }

  const url = new URL(request.url);
  const bookingId = Number(url.searchParams.get("bookingId"));
  const version = Number(url.searchParams.get("version"));
  if (!Number.isInteger(bookingId) || bookingId <= 0 || !Number.isInteger(version) || version <= 0) {
    return Response.json({ error:"Некоректні дані версії" }, { status:400 });
  }
  if (!await canAccessBooking(db, member, bookingId, ctx.organizationId)) {
    return Response.json({ error:"Версію не знайдено або дослідження не призначено вам" }, { status:404 });
  }

  const row = await db.prepare(
    `SELECT version, template_key AS templateKey, method, sections_json AS sectionsJson,
       findings, conclusion, recommendations, number, status,
       saved_by AS savedBy, created_at AS createdAt
     FROM protocol_revisions
     WHERE organization_id = ? AND booking_id = ? AND version = ? LIMIT 1`
  ).bind(ctx.organizationId, bookingId, version).first<Record<string, unknown>>();
  if (!row) return Response.json({ error:"Версію протоколу не знайдено" }, { status:404 });

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:member.email,
    action:"protocol_revision_viewed",
    resource:"protocol_revision",
    targetId:`${bookingId}:${version}`,
    details:{ version },
  });

  return Response.json({
    revision:{
      version:Number(row.version),
      templateKey:String(row.templateKey || "generic"),
      method:String(row.method || ""),
      sections:parseSections(String(row.sectionsJson || "{}")),
      findings:String(row.findings || ""),
      conclusion:String(row.conclusion || ""),
      recommendations:String(row.recommendations || ""),
      number:String(row.number || ""),
      status:String(row.status || "draft"),
      savedBy:String(row.savedBy || ""),
      createdAt:String(row.createdAt || ""),
    },
  }, { headers:{ "cache-control":"no-store" } });
}
