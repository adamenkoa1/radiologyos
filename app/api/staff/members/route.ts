import { requireStaff, type StaffRole } from "../../../../lib/staff-auth";
import { hashPassword } from "../../../../lib/auth";
import { logSecurityEvent } from "../../../../lib/audit";
import { passwordProblem } from "../../../../lib/staff-accounts";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { dbBinding } from "../../../../lib/db";

const roles = new Set<StaffRole>(["admin", "registrar", "radiologist", "radiographer"]);

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member || member.role !== "admin") {
    return Response.json({ error: "Доступ лише для адміністратора" }, { status: 403 });
  }
  const result = await db.prepare(
    `SELECT email, phone, display_name AS displayName, role, active, created_at AS createdAt
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
  const body = await request.json() as { phone?:string; displayName?:string; role?:StaffRole; active?:boolean; password?:string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  // email лишається внутрішнім id акаунта, похідним від номера телефону.
  const email = phone ? `${phone}@phone.local` : "";
  const displayName = (body.displayName || "").trim().slice(0, 120);
  const role = body.role;
  const active = body.active === false ? 0 : 1;
  const password = typeof body.password === "string" ? body.password : "";
  if (!phone || !role || !roles.has(role)) {
    return Response.json({ error: "Перевірте номер телефону і роль працівника" }, { status: 400 });
  }
  if (email === member.email && (role !== "admin" || active !== 1)) {
    return Response.json({ error: "Не можна забрати власний адміністративний доступ" }, { status: 409 });
  }
  const existing = await db.prepare("SELECT email FROM staff_members WHERE email = ? LIMIT 1").bind(email).first();
  if (!existing && !password) {
    return Response.json({ error: "Для нового працівника потрібно задати PIN-код" }, { status: 400 });
  }
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return Response.json({ error: problem }, { status: 400 });
  }
  await db.prepare(
    `INSERT INTO staff_members (email, phone, display_name, role, active)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       phone=excluded.phone, display_name=excluded.display_name, role=excluded.role, active=excluded.active`
  ).bind(email, phone, displayName, role, active).run();

  if (password) {
    await db.batch([
      db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
        .bind(await hashPassword(password), email),
      db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(email),
    ]);
  }
  await logSecurityEvent(db, {
    actorEmail: member.email,
    action: existing ? "staff_member_updated" : "staff_member_created",
    resource: "staff_member",
    targetId: email,
    details: { role, active: Boolean(active), passwordChanged: Boolean(password) },
  });
  return Response.json({ ok:true, needsPassword:false }, { status:201 });
}
