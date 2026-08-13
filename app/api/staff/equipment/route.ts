import { EQUIPMENT } from "../../../../lib/catalog";
import { isBookableDate } from "../../../../lib/booking-rules";
import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const blocks = await db.prepare(
    `SELECT id, equipment_id AS equipmentId, blocked_date AS blockedDate,
      start_time AS startTime, end_time AS endTime, reason
     FROM equipment_blocks
     WHERE organization_id = ? AND blocked_date >= date('now')
     ORDER BY blocked_date, start_time`
  ).bind(ctx.organizationId).all();
  return Response.json({ equipment: Object.values(EQUIPMENT), blocks: blocks.results });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.role !== "admin") return Response.json({ error: "Доступ лише для адміністратора" }, { status: 403 });
  const body = await request.json() as {equipmentId?:string;blockedDate?:string;startTime?:string;endTime?:string;reason?:string};
  if (!body.equipmentId || !(body.equipmentId in EQUIPMENT) || !body.blockedDate || !isBookableDate(body.blockedDate)
    || !/^\d{2}:\d{2}$/.test(body.startTime || "") || !/^\d{2}:\d{2}$/.test(body.endTime || "")
    || (body.startTime || "") >= (body.endTime || "")) {
    return Response.json({ error: "Перевірте апарат, дату та час блокування" }, { status: 400 });
  }
  await db.prepare(
    "INSERT INTO equipment_blocks (organization_id, equipment_id, blocked_date, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(ctx.organizationId, body.equipmentId, body.blockedDate, body.startTime, body.endTime, (body.reason || "").trim().slice(0, 240)).run();
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.role !== "admin") return Response.json({ error: "Доступ лише для адміністратора" }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Некоректний запис" }, { status: 400 });
  await db.prepare("DELETE FROM equipment_blocks WHERE organization_id = ? AND id = ?")
    .bind(ctx.organizationId, id).run();
  return Response.json({ ok: true });
}
