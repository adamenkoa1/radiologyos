// Графік прийому: години/крок слота по апаратах, робочі дні тижня та вихідні.
// Лише адміністратор. Зберігається у app_settings (equipment_schedule).

import { requireStaff } from "../../../../lib/staff-auth";
import { getSetting, setSetting } from "../../../../lib/settings";
import { parseSchedule, sanitizeSchedule, SCHEDULE_KEY } from "../../../../lib/schedule";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const [schedule, people] = await Promise.all([
    getSetting(db, SCHEDULE_KEY).then(parseSchedule),
    db.prepare(`SELECT email, display_name AS displayName, role, position_title AS positionTitle,
      military_rank AS militaryRank FROM staff_members
      WHERE active = 1 ORDER BY position_title, display_name`).all(),
  ]);
  return Response.json({ schedule, staff: member, people: people.results }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Змінювати графік може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { schedule?: unknown };
  const schedule = sanitizeSchedule(body.schedule);
  await setSetting(db, SCHEDULE_KEY, JSON.stringify(schedule));
  await audit(db, { organizationId: 1, actorEmail: member.email, action: "schedule_update", resource: "settings" });
  return Response.json({ ok: true, schedule }, { headers: { "cache-control": "no-store" } });
}
