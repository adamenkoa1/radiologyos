// Графік прийому: години/крок слота по апаратах, робочі дні тижня та вихідні.
// Читається персоналом організації; змінюється лише адміністратором організації.

import { requireOrgContext } from "../../../../lib/tenant";
import { getOrgSetting, setOrgSettingCompat } from "../../../../lib/settings";
import { parseSchedule, sanitizeSchedule, SCHEDULE_KEY } from "../../../../lib/schedule";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const [schedule, people] = await Promise.all([
    getOrgSetting(db, ctx.organizationId, SCHEDULE_KEY).then(parseSchedule),
    db.prepare(`SELECT s.email, s.display_name AS displayName, m.role AS role,
      s.position_title AS positionTitle, s.military_rank AS militaryRank
      FROM memberships m
      JOIN staff_members s ON s.email = m.member_email AND s.active = 1
      WHERE m.organization_id = ? AND m.active = 1
      ORDER BY s.position_title, s.display_name`).bind(ctx.organizationId).all(),
  ]);
  return Response.json({
    schedule,
    staff: { ...ctx.member, role: ctx.role },
    people: people.results,
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = { ...ctx.member, role: ctx.role };
  if (member.role !== "admin") return Response.json({ error: "Змінювати графік може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { schedule?: unknown };
  const schedule = sanitizeSchedule(body.schedule);
  const setSetting = (database: D1Database, key: string, value: string) =>
    setOrgSettingCompat(database, ctx.organizationId, key, value);
  await setSetting(db, SCHEDULE_KEY, JSON.stringify(schedule));
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: member.email,
    action: "schedule_update",
    resource: "settings",
  });
  return Response.json({ ok: true, schedule }, { headers: { "cache-control": "no-store" } });
}
