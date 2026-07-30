// Графік прийому: години/крок слота по апаратах, робочі дні тижня та вихідні.
// Лише адміністратор. Зберігається у app_settings (equipment_schedule).

import { requireStaff } from "../../../../lib/staff-auth";
import { getSetting, setSetting } from "../../../../lib/settings";
import { parseSchedule, sanitizeSchedule, SCHEDULE_KEY } from "../../../../lib/schedule";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Графік налаштовує лише адміністратор" }, { status: 403 });

  const schedule = parseSchedule(await getSetting(db, SCHEDULE_KEY));
  return Response.json({ schedule, staff: member }, { headers: { "cache-control": "no-store" } });
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
  return Response.json({ ok: true, schedule }, { headers: { "cache-control": "no-store" } });
}
