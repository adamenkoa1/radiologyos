import { requireSelfServiceOrgContext } from "../../../../lib/tenant";
import { hashPassword, verifyPassword } from "../../../../lib/auth";
import { passwordProblem } from "../../../../lib/staff-accounts";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

function clean(value: unknown, max = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validBirthDate(value: string) {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return false;
  return value <= new Date().toISOString().slice(0, 10);
}

type AuditOrganizationRow = { organizationId: number };

type CurrentIdentity = {
  email: string;
  phone: string | null;
  passwordHash: string;
  lastName: string;
  firstName: string;
  patronymic: string;
  contactEmail: string;
};

type PersonnelLink = {
  id: string;
  dateOfBirth: string;
};

async function profileSecurityAuditOrganizationIds(
  db: D1Database,
  memberEmail: string,
  fallbackOrganizationId: number,
): Promise<number[]> {
  const linked = await db.prepare(
    `SELECT DISTINCT m.organization_id AS organizationId
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.member_email = ? AND m.active = 1 AND o.active = 1
     ORDER BY m.organization_id`
  ).bind(memberEmail).all<AuditOrganizationRow>();
  const ids = linked.results
    .map((row) => Number(row.organizationId))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length > 0) return ids;

  const membershipCount = await db.prepare("SELECT COUNT(*) AS n FROM memberships").first<{ n: number }>();
  if (Number(membershipCount?.n || 0) !== 0) return [];

  const activeOrganizations = await db.prepare(
    "SELECT id AS organizationId FROM organizations WHERE active = 1 ORDER BY id LIMIT 2"
  ).all<AuditOrganizationRow>();
  if (activeOrganizations.results.length !== 1) return [];
  const organizationId = Number(activeOrganizations.results[0]?.organizationId);
  return Number.isInteger(organizationId)
    && organizationId > 0
    && organizationId === fallbackOrganizationId
    ? [organizationId]
    : [];
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Потрібно увійти" }, { status: 401 });
  const staff = ctx.member;

  const profile = await db.prepare(
    `SELECT s.email, s.phone, s.display_name AS displayName,
       COALESCE(NULLIF(p.last_name, ''), s.last_name) AS lastName,
       COALESCE(NULLIF(p.first_name, ''), s.first_name) AS firstName,
       COALESCE(NULLIF(p.patronymic, ''), s.patronymic) AS patronymic,
       s.contact_email AS contactEmail,
       COALESCE(NULLIF(p.military_rank, ''), s.military_rank) AS militaryRank,
       COALESCE(NULLIF(p.position_title, ''), s.position_title) AS positionTitle,
       COALESCE(p.date_of_birth, '') AS dateOfBirth,
       p.id AS personnelId,
       COALESCE(d.name, '') AS departmentName,
       s.active
     FROM staff_members s
     LEFT JOIN personnel_records p
       ON p.organization_id = ? AND p.account_email = s.email AND p.active = 1
     LEFT JOIN departments d
       ON d.id = p.department_id AND d.organization_id = p.organization_id
     WHERE s.email = ? AND s.active = 1
     LIMIT 1`
  ).bind(ctx.organizationId, staff.email).first<Record<string, unknown>>();

  if (!profile) return Response.json({ error: "Обліковий запис не знайдено" }, { status: 404 });
  return Response.json({
    profile: {
      ...profile,
      role: ctx.role,
      hasPersonnelRecord: Boolean(profile.personnelId),
    },
  }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Потрібно увійти" }, { status: 401 });
  const staff = ctx.member;

  const body = await request.json().catch(() => ({})) as {
    phone?: string;
    firstName?: string;
    lastName?: string;
    patronymic?: string;
    contactEmail?: string;
    dateOfBirth?: string;
    currentPin?: string;
    newPin?: string;
  };

  const [current, personnel] = await Promise.all([
    db.prepare(
      `SELECT email, phone, password_hash AS passwordHash,
         last_name AS lastName, first_name AS firstName, patronymic,
         contact_email AS contactEmail
       FROM staff_members WHERE email = ? AND active = 1 LIMIT 1`
    ).bind(staff.email).first<CurrentIdentity>(),
    db.prepare(
      `SELECT id, date_of_birth AS dateOfBirth
       FROM personnel_records
       WHERE organization_id = ? AND account_email = ? AND active = 1
       LIMIT 1`
    ).bind(ctx.organizationId, staff.email).first<PersonnelLink>(),
  ]);
  if (!current) return Response.json({ error: "Обліковий запис не знайдено" }, { status: 404 });

  const phone = body.phone == null ? null : normalizeUkrainianPhone(body.phone);
  if (body.phone != null && !phone) return Response.json({ error: "Перевірте номер телефону" }, { status: 400 });
  const phoneChanged = body.phone != null && phone !== (current.phone || "");

  const firstName = body.firstName == null ? null : clean(body.firstName, 60);
  const lastName = body.lastName == null ? null : clean(body.lastName, 60);
  const patronymic = body.patronymic == null ? null : clean(body.patronymic, 60);
  const contactEmail = body.contactEmail == null ? null : clean(body.contactEmail, 254).toLowerCase();
  const dateOfBirth = body.dateOfBirth == null ? null : clean(body.dateOfBirth, 10);

  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return Response.json({ error: "Перевірте e-mail" }, { status: 400 });
  }
  if (dateOfBirth !== null && !validBirthDate(dateOfBirth)) {
    return Response.json({ error: "Перевірте дату народження" }, { status: 400 });
  }
  if (dateOfBirth !== null && !personnel) {
    return Response.json({ error: "Кадрова картка не прив’язана до цього облікового запису" }, { status: 409 });
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
  }

  const securityChange = wantsPinChange || phoneChanged;
  if (securityChange) {
    if (!body.currentPin || !(await verifyPassword(body.currentPin, current.passwordHash))) {
      return Response.json({ error: "Поточний PIN-код невірний" }, { status: 401 });
    }
  }

  const finalLastName = lastName ?? current.lastName ?? "";
  const finalFirstName = firstName ?? current.firstName ?? "";
  const finalPatronymic = patronymic ?? current.patronymic ?? "";
  const displayName = [finalLastName, finalFirstName, finalPatronymic].filter(Boolean).join(" ").slice(0, 180);
  const nameChanged = finalLastName !== current.lastName
    || finalFirstName !== current.firstName
    || finalPatronymic !== current.patronymic;
  const contactEmailChanged = contactEmail !== null && contactEmail !== current.contactEmail;
  const dateOfBirthChanged = dateOfBirth !== null && dateOfBirth !== (personnel?.dateOfBirth || "");

  const statements = [
    db.prepare(
      `UPDATE staff_members SET
         phone = COALESCE(?, phone),
         last_name = COALESCE(?, last_name),
         first_name = COALESCE(?, first_name),
         patronymic = COALESCE(?, patronymic),
         contact_email = COALESCE(?, contact_email),
         display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END
       WHERE email = ?`
    ).bind(phone, lastName, firstName, patronymic, contactEmail, displayName, displayName, staff.email),
  ];

  if (personnel) {
    statements.push(
      db.prepare(
        `UPDATE personnel_records SET
           last_name = COALESCE(?, last_name),
           first_name = COALESCE(?, first_name),
           patronymic = COALESCE(?, patronymic),
           display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
           personal_phone = COALESCE(?, personal_phone),
           alternate_email = COALESCE(?, alternate_email),
           date_of_birth = COALESCE(?, date_of_birth),
           updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND organization_id = ?`
      ).bind(
        lastName, firstName, patronymic, displayName, displayName,
        phone, contactEmail, dateOfBirth, staff.email, personnel.id, ctx.organizationId,
      ),
    );
  }

  if (wantsPinChange) {
    statements.push(
      db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
        .bind(await hashPassword(body.newPin || ""), staff.email),
    );
  }
  if (securityChange) {
    statements.push(db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(staff.email));
  }
  await db.batch(statements);

  const auditOrganizationIds = securityChange
    ? await profileSecurityAuditOrganizationIds(db, staff.email, ctx.organizationId)
    : [ctx.organizationId];
  const auditDetails = securityChange
    ? {
        phoneChanged,
        pinChanged: wantsPinChange,
      }
    : {
        phoneChanged,
        pinChanged: wantsPinChange,
        dateOfBirthChanged,
        nameChanged,
        contactEmailChanged,
        personnelLinked: Boolean(personnel),
      };
  for (const organizationId of auditOrganizationIds) {
    await audit(db, {
      organizationId,
      actorEmail: staff.email,
      action: securityChange ? "profile_security_update" : "profile_update",
      resource: "staff",
      targetId: staff.email,
      details: auditDetails,
    });
  }

  return Response.json({ ok: true, signedOut: securityChange });
}
