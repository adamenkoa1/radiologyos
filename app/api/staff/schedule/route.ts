// Графік прийому: години/крок слота по апаратах, робочі дні тижня та вихідні.
// Лише адміністратор поточної організації.

import { sanitizeSchedule } from "../../../../lib/schedule";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";
import { requireOrgContext } from "../../../../lib/tenant";
import { getOrganizationSchedule, setOrganizationSchedule } from "../../../../lib/tenant-schedule";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const [schedule, people] = await Promise.all([
    getOrganizationSchedule(db, ctx.organizationId),
    db.prepare(`SELECT s.email, s.display_name AS displayName, m.role AS role,
      s.position_title AS positionTitle, s.military_rank AS militaryRank
      FROM memberships m
      JOIN staff_members s ON s.email = m.member_email
      WHERE m.organization_id = ? AND m.active = 1 AND s.active = 1
      ORDER BY s.position_title, s.display_name`).bind(ctx.organizationId).all(),
  ]);
  return Response.json(
    { schedule, staff: ctx.member, people: people.results },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.member.role !== "admin") {
    return Response.json({ error: "Змінювати графік може лише адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { schedule?: unknown };
  const schedule = sanitizeSchedule(body.schedule);
  await setOrganizationSchedule(db, ctx.organizationId, schedule);
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "schedule_update",
    resource: "settings",
  });
  return Response.json({ ok: true, schedule }, { headers: { "cache-control": "no-store" } });
}
