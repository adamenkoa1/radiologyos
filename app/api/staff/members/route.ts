import { requireStaff, type StaffRole } from "../../../../lib/staff-auth";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

const roles = new Set<StaffRole>(["admin", "registrar", "radiologist", "radiographer"]);

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member || member.role !== "admin") {
    return Response.json({ error: "Доступ лише для адміністратора" }, { status: 403 });
  }
  const result = await db.prepare(
    `SELECT email, display_name AS displayName, role, active, created_at AS createdAt
     FROM staff_members ORDER BY active DESC, display_name, email`
  ).all();
  return Response.json({ members: result.results });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member || member.role !== "admin") {
    return Response.json({ error: "Доступ лише для адміністратора" }, { status: 403 });
  }
  const body = await request.json() as { email?:string; displayName?:string; role?:StaffRole; active?:boolean };
  const email = (body.email || "").trim().toLowerCase().slice(0, 254);
  const displayName = (body.displayName || "").trim().slice(0, 120);
  const role = body.role;
  const active = body.active === false ? 0 : 1;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role || !roles.has(role)) {
    return Response.json({ error: "Перевірте email і роль працівника" }, { status: 400 });
  }
  if (email === member.email && (role !== "admin" || active !== 1)) {
    return Response.json({ error: "Не можна забрати власний адміністративний доступ" }, { status: 409 });
  }
  await db.prepare(
    `INSERT INTO staff_members (email, display_name, role, active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       display_name=excluded.display_name, role=excluded.role, active=excluded.active`
  ).bind(email, displayName, role, active).run();
  return Response.json({ ok:true }, { status:201 });
}
