import { requireStaff, type StaffRole } from "../../../../lib/staff-auth";
import { hashPassword } from "../../../../lib/auth";
import { audit } from "../../../../lib/audit";
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
    `SELECT email, phone, display_name AS displayName, last_name AS lastName,
       first_name AS firstName, patronymic, contact_email AS contactEmail,
       military_rank AS militaryRank, position_title AS positionTitle,
       role, active, created_at AS createdAt
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
  const body = await request.json() as { phone?:string; lastName?:string; firstName?:string; patronymic?:string; contactEmail?:string; militaryRank?:string; positionTitle?:string; role?:StaffRole; active?:boolean; password?:string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  // email лишається внутрішнім id акаунта, похідним від номера телефону.
  const email = phone ? `${phone}@phone.local` : "";
  const clean = (value:unknown, max=120) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
  const lastName = clean(body.lastName, 60);
  const firstName = clean(body.firstName, 60);
  const patronymic = clean(body.patronymic, 60);
  const contactEmail = clean(body.contactEmail, 254).toLowerCase();
  const militaryRank = clean(body.militaryRank, 80);
  const positionTitle = clean(body.positionTitle, 120);
  const displayName = [lastName, firstName, patronymic].filter(Boolean).join(" ").slice(0, 180);
  const role = body.role;
  const active = body.active === false ? 0 : 1;
  const password = typeof body.password === "string" ? body.password : "";
  if (!phone || !lastName || !firstName || !positionTitle || !role || !roles.has(role)) {
    return Response.json({ error: "Перевірте номер телефону і роль. Заповніть також прізвище, ім’я та посаду" }, { status: 400 });
  }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return Response.json({ error: "Перевірте e-mail працівника" }, { status: 400 });
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
    `INSERT INTO staff_members (email, phone, display_name, last_name, first_name, patronymic,
       contact_email, military_rank, position_title, role, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       phone=excluded.phone, display_name=excluded.display_name, last_name=excluded.last_name,
       first_name=excluded.first_name, patronymic=excluded.patronymic,
       contact_email=excluded.contact_email, military_rank=excluded.military_rank,
       position_title=excluded.position_title, role=excluded.role, active=excluded.active`
  ).bind(email, phone, displayName, lastName, firstName, patronymic, contactEmail, militaryRank, positionTitle, role, active).run();

  if (password) {
    await db.batch([
      db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
        .bind(await hashPassword(password), email),
      db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(email),
    ]);
  }
  await audit(db, {
    organizationId: 1,
    actorEmail: member.email,
    action: existing ? "member_role" : "member_add",
    resource: "staff",
    targetId: phone,
    details: { role, active: Boolean(active), passwordChanged: Boolean(password) },
  });
  return Response.json({ ok:true, needsPassword:false }, { status:201 });
}
