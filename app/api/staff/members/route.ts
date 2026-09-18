import { canManageSystem, type AccessRole, type StaffRole } from "../../../../lib/staff-auth";
import { requireSystemOrgContext } from "../../../../lib/tenant";
import { hashPassword } from "../../../../lib/auth";
import { audit } from "../../../../lib/audit";
import { passwordProblem } from "../../../../lib/staff-accounts";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { dbBinding } from "../../../../lib/db";

const roles = new Set<AccessRole>([
  "admin",
  "organization_admin",
  "department_head",
  "registrar",
  "radiologist",
  "radiographer",
]);

function identityRoleForMembership(role: AccessRole): StaffRole {
  // Global staff_members.role is retained only for legacy login/bootstrap
  // compatibility. Organization-specific authorization comes from memberships.
  return role === "organization_admin" || role === "department_head" ? "admin" : role;
}

type StaffIdentity = {
  email:string;
  phone:string | null;
  lastName:string | null;
  firstName:string | null;
  patronymic:string | null;
  contactEmail:string | null;
  militaryRank:string | null;
  positionTitle:string | null;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx || !canManageSystem(ctx.member.role)) {
    return Response.json({ error: "Доступ лише для системного адміністратора" }, { status: 403 });
  }
  const result = await db.prepare(
    `SELECT s.email, s.phone, s.display_name AS displayName, s.last_name AS lastName,
       s.first_name AS firstName, s.patronymic, s.contact_email AS contactEmail,
       s.military_rank AS militaryRank, s.position_title AS positionTitle,
       m.role, m.active, m.created_at AS createdAt
     FROM memberships m
     JOIN staff_members s ON s.email = m.member_email
     WHERE m.organization_id = ?
     ORDER BY m.active DESC, s.display_name, s.email`
  ).bind(ctx.organizationId).all();
  return Response.json({ members: result.results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx || !canManageSystem(ctx.member.role)) {
    return Response.json({ error: "Доступ лише для системного адміністратора" }, { status: 403 });
  }
  const body = await request.json() as { phone?:string; lastName?:string; firstName?:string; patronymic?:string; contactEmail?:string; militaryRank?:string; positionTitle?:string; role?:AccessRole; active?:boolean; password?:string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
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
  if (email === ctx.member.email && (!canManageSystem(role) || active !== 1)) {
    return Response.json({ error: "Не можна забрати власний системний адміністративний доступ" }, { status: 409 });
  }

  const [identity, existing, otherMembership] = await Promise.all([
    db.prepare(
      `SELECT email, phone, last_name AS lastName, first_name AS firstName, patronymic,
         contact_email AS contactEmail, military_rank AS militaryRank, position_title AS positionTitle
       FROM staff_members WHERE email = ? LIMIT 1`
    ).bind(email).first<StaffIdentity>(),
    db.prepare(
      "SELECT role, active FROM memberships WHERE organization_id = ? AND member_email = ? LIMIT 1"
    ).bind(ctx.organizationId, email).first<{ role:string; active:number }>(),
    db.prepare(
      `SELECT active FROM memberships
       WHERE member_email = ? AND organization_id <> ?
       ORDER BY active DESC
       LIMIT 1`
    ).bind(email, ctx.organizationId).first<{ active:number }>(),
  ]);
  if (!identity && !password) {
    return Response.json({ error: "Для нового працівника потрібно задати PIN-код" }, { status: 400 });
  }
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return Response.json({ error: problem }, { status: 400 });
  }

  const sharedIdentity = Boolean(identity && otherMembership);
  const hasOtherActiveMembership = Number(otherMembership?.active) === 1;
  if (sharedIdentity && identity) {
    const sameProfile =
      String(identity.phone || "") === phone &&
      String(identity.lastName || "") === lastName &&
      String(identity.firstName || "") === firstName &&
      String(identity.patronymic || "") === patronymic &&
      String(identity.contactEmail || "").toLowerCase() === contactEmail &&
      String(identity.militaryRank || "") === militaryRank &&
      String(identity.positionTitle || "") === positionTitle;
    if (password || !sameProfile) {
      return Response.json(
        { error: "Цей обліковий запис використовується іншою організацією. Тут можна змінити лише роль та активність; PIN і профіль залишаються спільними" },
        { status: 409 },
      );
    }
  }

  const statements = [];
  if (!sharedIdentity) {
    statements.push(
      db.prepare(
        `INSERT INTO staff_members (email, phone, display_name, last_name, first_name, patronymic,
           contact_email, military_rank, position_title, role, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(email) DO UPDATE SET
           phone=excluded.phone, display_name=excluded.display_name, last_name=excluded.last_name,
           first_name=excluded.first_name, patronymic=excluded.patronymic,
           contact_email=excluded.contact_email, military_rank=excluded.military_rank,
           position_title=excluded.position_title`
      ).bind(
        email, phone, displayName, lastName, firstName, patronymic,
        contactEmail, militaryRank, positionTitle, identityRoleForMembership(role),
      ),
    );
  }
  statements.push(
    db.prepare(
      `INSERT INTO memberships (organization_id, member_email, role, active)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(organization_id, member_email) DO UPDATE SET
         role=excluded.role, active=excluded.active`
    ).bind(ctx.organizationId, email, role, active),
  );

  // Identity sessions are shared across tenants. Revoke them only when this
  // deactivation removes the member's final active organization access; otherwise
  // preserve sessions that are still legitimately needed by another organization.
  if (existing && existing.active === 1 && active === 0 && !hasOtherActiveMembership) {
    statements.push(db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(email));
  }

  if (password) {
    statements.push(
      db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
        .bind(await hashPassword(password), email),
      db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(email),
    );
  }
  await db.batch(statements);

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: existing ? "member_role" : "member_add",
    resource: "staff",
    targetId: phone,
    details: { role, active: Boolean(active), passwordChanged: Boolean(password), sharedIdentity },
  });
  return Response.json({ ok:true, needsPassword:false }, { status:201 });
}
