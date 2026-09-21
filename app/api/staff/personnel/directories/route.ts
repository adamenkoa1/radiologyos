// Кадрові довідники: посади (personnel_positions) та звання (personnel_ranks).
// Раніше значення були захардкоджені в клієнті; тепер це tenant-scoped
// довідники, які редагуються без деплою. Права — адміністратор або керівник
// підрозділу (як і решта кадрового модуля). Значення живлять datalist-підказки
// над free-text полями, тож деактивація запису не ламає вже збережені картки.
import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";
import type { AccessRole } from "../../../../../lib/staff-auth";

const TABLES = { position: "personnel_positions", rank: "personnel_ranks" } as const;
type Kind = keyof typeof TABLES;
type Row = { id: number; name: string; active: number };

function canManagePersonnel(role: AccessRole) {
  return role === "admin" || role === "department_head";
}
function clean(value: unknown, max = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}
// Whitelist: table name never comes from user input, only from these constants.
function tableFor(value: unknown): string | null {
  return value === "position" || value === "rank" ? TABLES[value as Kind] : null;
}

async function requireManager(request: Request, db: D1Database) {
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManagePersonnel(ctx.member.role)) return null;
  return ctx;
}

async function listKind(db: D1Database, table: string, organizationId: number) {
  const { results } = await db.prepare(
    `SELECT id, name, active FROM ${table} WHERE organization_id = ? ORDER BY active DESC, name COLLATE NOCASE`,
  ).bind(organizationId).all<Row>();
  return (results || []).map((row) => ({ id: Number(row.id), name: String(row.name), active: Number(row.active) }));
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Базу даних недоступно" }, { status: 503 });
  const ctx = await requireManager(request, db);
  if (!ctx) return Response.json({ error: "Немає доступу до кадрових довідників" }, { status: 403 });
  const [positions, ranks] = await Promise.all([
    listKind(db, TABLES.position, ctx.organizationId),
    listKind(db, TABLES.rank, ctx.organizationId),
  ]);
  return Response.json({ positions, ranks });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Базу даних недоступно" }, { status: 503 });
  const ctx = await requireManager(request, db);
  if (!ctx) return Response.json({ error: "Довідники персоналу може змінювати лише адміністратор або керівник підрозділу" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { kind?: unknown; name?: unknown };
  const table = tableFor(body.kind);
  if (!table) return Response.json({ error: "Невідомий довідник" }, { status: 400 });
  const name = clean(body.name);
  if (!name) return Response.json({ error: "Вкажіть назву" }, { status: 400 });
  const existing = await db.prepare(
    `SELECT id FROM ${table} WHERE organization_id = ? AND name = ?`,
  ).bind(ctx.organizationId, name).first<{ id: number }>();
  if (existing) return Response.json({ error: "Такий запис уже існує" }, { status: 409 });
  const result = await db.prepare(
    `INSERT INTO ${table} (organization_id, name) VALUES (?, ?)`,
  ).bind(ctx.organizationId, name).run();
  const id = Number(result.meta?.last_row_id) || undefined;
  await audit(db, {
    organizationId: ctx.organizationId, actorEmail: ctx.member.email,
    action: "personnel_directory_created", resource: table, targetId: String(id ?? ""), details: { name },
  });
  return Response.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Базу даних недоступно" }, { status: 503 });
  const ctx = await requireManager(request, db);
  if (!ctx) return Response.json({ error: "Довідники персоналу може змінювати лише адміністратор або керівник підрозділу" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { kind?: unknown; id?: unknown; name?: unknown; active?: unknown };
  const table = tableFor(body.kind);
  if (!table) return Response.json({ error: "Невідомий довідник" }, { status: 400 });
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Невідомий запис" }, { status: 400 });
  const current = await db.prepare(
    `SELECT id, name, active FROM ${table} WHERE id = ? AND organization_id = ?`,
  ).bind(id, ctx.organizationId).first<Row>();
  if (!current) return Response.json({ error: "Запис не знайдено" }, { status: 404 });
  const name = body.name === undefined ? current.name : clean(body.name);
  if (!name) return Response.json({ error: "Вкажіть назву" }, { status: 400 });
  const active = body.active === undefined ? current.active : (body.active ? 1 : 0);
  if (name !== current.name) {
    const dup = await db.prepare(
      `SELECT id FROM ${table} WHERE organization_id = ? AND name = ? AND id <> ?`,
    ).bind(ctx.organizationId, name, id).first();
    if (dup) return Response.json({ error: "Такий запис уже існує" }, { status: 409 });
  }
  await db.prepare(
    `UPDATE ${table} SET name = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`,
  ).bind(name, active, id, ctx.organizationId).run();
  await audit(db, {
    organizationId: ctx.organizationId, actorEmail: ctx.member.email,
    action: "personnel_directory_updated", resource: table, targetId: String(id), details: { name, active },
  });
  return Response.json({ ok: true });
}
