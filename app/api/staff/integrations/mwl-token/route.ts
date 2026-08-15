import { dbBinding } from "../../../../../lib/db";
import { generateBridgeToken, hashBridgeToken } from "../../../../../lib/mwl-bridge";
import { canManageSystem } from "../../../../../lib/staff-auth";
import { requireSystemOrgContext } from "../../../../../lib/tenant";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageSystem(ctx.member.role)) {
    return Response.json({ error: "Керувати MWL bridge може лише системний адміністратор" }, { status: 403 });
  }

  const row = await db.prepare(
    `SELECT active, created_by AS createdBy, created_at AS createdAt,
      rotated_at AS rotatedAt, last_used_at AS lastUsedAt
     FROM mwl_bridge_tokens WHERE organization_id = ? LIMIT 1`,
  ).bind(ctx.organizationId).first<Record<string, unknown>>();

  return Response.json({
    configured: !!row,
    active: !!Number(row?.active || 0),
    createdBy: String(row?.createdBy || ""),
    createdAt: String(row?.createdAt || ""),
    rotatedAt: String(row?.rotatedAt || ""),
    lastUsedAt: String(row?.lastUsedAt || ""),
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageSystem(ctx.member.role)) {
    return Response.json({ error: "Керувати MWL bridge може лише системний адміністратор" }, { status: 403 });
  }

  const token = `mwl_${generateBridgeToken()}`;
  const tokenHash = await hashBridgeToken(token);
  await db.prepare(
    `INSERT INTO mwl_bridge_tokens
      (organization_id, token_hash, active, created_by, created_at, rotated_at, last_used_at)
     VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '')
     ON CONFLICT(organization_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       active = 1,
       created_by = excluded.created_by,
       rotated_at = CURRENT_TIMESTAMP,
       last_used_at = ''`,
  ).bind(ctx.organizationId, tokenHash, ctx.member.email).run();

  return Response.json({
    ok: true,
    token,
    oneTime: true,
    message: "Збережіть токен зараз: після закриття цієї відповіді RadiologyOS більше його не покаже.",
  }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageSystem(ctx.member.role)) {
    return Response.json({ error: "Керувати MWL bridge може лише системний адміністратор" }, { status: 403 });
  }

  const result = await db.prepare(
    "UPDATE mwl_bridge_tokens SET active = 0 WHERE organization_id = ?",
  ).bind(ctx.organizationId).run();
  return Response.json({ ok: true, changed: Number(result.meta.changes || 0) > 0 });
}
