import { requireOrgContext } from "../../../../lib/tenant";
import { hashPassword, verifyPassword } from "../../../../lib/auth";
import { passwordProblem } from "../../../../lib/staff-accounts";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

function clean(value: unknown, max = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Потрібно увійти" }, { status: 401 });
  const staff = ctx.member;

  const profile = await db.prepare(
    `SELECT email, phone, display_name AS displayName, last_name AS lastName,
       first_name AS firstName, patronymic, contact_email AS contactEmail,
       military_rank AS militaryRank, position_title AS positionTitle,
       role, active
     FROM staff_members WHERE email = ? AND active = 1 LIMIT 1`
  ).bind(staff.email).first();

  if (!profile) return Response.json({ error: "Обліковий запис не знайдено" }, { status: 404 });
  return Response.json({ profile });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Потрібно увійти" }, { status: 401 });
  const staff = ctx.member;

  const body = await request.json().catch(() => ({})) as {
    phone?: string;
    firstName?: string;
    lastName?: string;
    patronymic?: string;
    contactEmail?: string;
    militaryRank?: string;
    positionTitle?: string;
    currentPin?: string;
    newPin?: string;
  };

  const current = await db.prepare(
    `SELECT email, password_hash AS passwordHash FROM staff_members
     WHERE email = ? AND active = 1 LIMIT 1`
  ).bind(staff.email).first<{ email: string; passwordHash: string }>();
  if (!current) return Response.json({ error: "Обліковий запис не знайдено" }, { status: 404 });

  const phone = body.phone == null ? null : normalizeUkrainianPhone(body.phone);
  if (body.phone != null && !phone) return Response.json({ error: "Перевірте номер телефону" }, { status: 400 });

  const firstName = body.firstName == null ? null : clean(body.firstName, 60);
  const lastName = body.lastName == null ? null : clean(body.lastName, 60);
  const patronymic = body.patronymic == null ? null : clean(body.patronymic, 60);
  const contactEmail = body.contactEmail == null ? null : clean(body.contactEmail, 254).toLowerCase();
  const militaryRank = body.militaryRank == null ? null : clean(body.militaryRank, 80);
  const positionTitle = body.positionTitle == null ? null : clean(body.positionTitle, 120);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return Response.json({ error: "Перевірте e-mail" }, { status: 400 });
  }

  if (phone) {
    const duplicate = await db.prepare(
      "SELECT email FROM staff_members WHERE phone = ? AND email <> ? LIMIT 1"
    ).bind(phone, staff.email).first();
    if (duplicate) return Response.json({ error: "Цей номер вже використовується іншим працівником" }, { status: 409 });
  }

  const wantsPinChange = typeof body.newPin === "string" && body.newPin.length > 0;
  if (wantsPinChange) {
    const problem = passwordProblem(body.newPin || "");
    if (problem) return Response.json({ error: problem }, { status: 400 });
    if (!body.currentPin || !(await verifyPassword(body.currentPin, current.passwordHash))) {
      return Response.json({ error: "Поточний PIN-код невірний" }, { status: 401 });
    }
  }

  const existingProfile = await db.prepare(
    `SELECT last_name AS lastName, first_name AS firstName, patronymic
     FROM staff_members WHERE email = ? LIMIT 1`
  ).bind(staff.email).first<{ lastName: string; firstName: string; patronymic: string }>();
  const finalLastName = lastName ?? existingProfile?.lastName ?? "";
  const finalFirstName = firstName ?? existingProfile?.firstName ?? "";
  const finalPatronymic = patronymic ?? existingProfile?.patronymic ?? "";
  const displayName = [finalLastName, finalFirstName, finalPatronymic].filter(Boolean).join(" ").slice(0, 180);

  await db.prepare(
    `UPDATE staff_members SET
       phone = COALESCE(?, phone),
       last_name = COALESCE(?, last_name),
       first_name = COALESCE(?, first_name),
       patronymic = COALESCE(?, patronymic),
       contact_email = COALESCE(?, contact_email),
       military_rank = COALESCE(?, military_rank),
       position_title = COALESCE(?, position_title),
       display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END
     WHERE email = ?`
  ).bind(phone, lastName, firstName, patronymic, contactEmail, militaryRank, positionTitle, displayName, displayName, staff.email).run();

  if (wantsPinChange) {
    await db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
      .bind(await hashPassword(body.newPin || ""), staff.email).run();
    await db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(staff.email).run();
  }

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: staff.email,
    action: wantsPinChange ? "profile_security_update" : "profile_update",
    resource: "staff",
    targetId: staff.email,
    details: { phoneChanged: body.phone != null, pinChanged: wantsPinChange },
  });

  return Response.json({ ok: true, signedOut: wantsPinChange });
}
