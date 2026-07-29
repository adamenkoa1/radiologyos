import { requireStaff, type StaffRole } from "../../../../lib/staff-auth";
import { hashPassword } from "../../../../lib/auth";
import { logSecurityEvent } from "../../../../lib/audit";
import { passwordProblem } from "../../../../lib/staff-accounts";

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
    `SELECT m.email, m.display_name AS displayName, om.role, om.active,
      om.created_at AS createdAt, om.department_id AS departmentId
     FROM organization_memberships om
     JOIN staff_members m ON m.email = om.staff_email
     WHERE om.organization_id = ?
     ORDER BY om.active DESC, m.display_name, m.email`
  ).bind(member.organizationId).all();
  return Response.json({ members: result.results });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member || member.role !== "admin") {
    return Response.json({ error: "Доступ лише для адміністратора" }, { status: 403 });
  }
  const body = await request.json() as { email?:string; displayName?:string; role?:StaffRole; active?:boolean; password?:string };
  const email = (body.email || "").trim().toLowerCase().slice(0, 254);
  const displayName = (body.displayName || "").trim().slice(0, 120);
  const role = body.role;
  const active = body.active === false ? 0 : 1;
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role || !roles.has(role)) {
    return Response.json({ error: "Перевірте email і роль працівника" }, { status: 400 });
  }
  if (email === member.email && (role !== "admin" || active !== 1)) {
    return Response.json({ error: "Не можна забрати власний адміністративний доступ" }, { status: 409 });
  }
  const existing = await db.prepare("SELECT email FROM staff_members WHERE email = ? LIMIT 1").bind(email).first();
  if (!existing && !password) {
    return Response.json({ error: "Для нового працівника потрібно задати тимчасовий пароль" }, { status: 400 });
  }
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return Response.json({ error: problem }, { status: 400 });
  }
  await db.prepare(
    `INSERT INTO staff_members (email, display_name, role, active)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(email) DO UPDATE SET
       display_name=excluded.display_name, role=excluded.role`
  ).bind(email, displayName, role).run();
  await db.prepare(
    `INSERT INTO organization_memberships
      (organization_id, staff_email, department_id, role, active)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, staff_email) DO UPDATE SET
       department_id=excluded.department_id,
       role=excluded.role,
       active=excluded.active`
  ).bind(
    member.organizationId,
    email,
    member.departmentId,
    role,
    active,
  ).run();

  if (password) {
    await db.batch([
      db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
        .bind(await hashPassword(password), email),
      db.prepare(
        "DELETE FROM staff_sessions WHERE email = ? AND organization_id = ?"
      ).bind(email, member.organizationId),
    ]);
  }
  await logSecurityEvent(db, {
    actorEmail: member.email,
    organizationId: member.organizationId,
    action: existing ? "staff_member_updated" : "staff_member_created",
    resource: "staff_member",
    targetId: email,
    details: { role, active: Boolean(active), passwordChanged: Boolean(password) },
  });
  return Response.json({ ok:true, needsPassword:false }, { status:201 });
}
