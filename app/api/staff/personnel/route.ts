import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { requireSelfServiceOrgContext } from "../../../../lib/tenant";
import type { AccessRole } from "../../../../lib/staff-auth";

const EMPLOYMENT_KINDS = new Set(["unspecified", "military", "civilian", "contractor", "other"]);

function canManagePersonnel(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function clean(value: unknown, max = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanEmail(value: unknown) {
  return clean(value, 254).toLowerCase();
}

function validEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validDate(value: string) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

type PersonnelInput = {
  id?: string;
  accountEmail?: string | null;
  staffNumber?: string;
  employmentKind?: string;
  lastName?: string;
  firstName?: string;
  patronymic?: string;
  dateOfBirth?: string;
  militaryRank?: string;
  positionTitle?: string;
  departmentId?: number | string | null;
  workPhone?: string;
  personalPhone?: string;
  workEmail?: string;
  alternateEmail?: string;
  region?: string;
  city?: string;
  addressLine?: string;
  postalCode?: string;
  active?: boolean;
};

function parseInput(body: PersonnelInput) {
  const lastName = clean(body.lastName, 80);
  const firstName = clean(body.firstName, 80);
  const patronymic = clean(body.patronymic, 80);
  const displayName = [lastName, firstName, patronymic].filter(Boolean).join(" ").slice(0, 240);
  const employmentKind = clean(body.employmentKind || "unspecified", 24);
  const departmentNumber = body.departmentId == null || body.departmentId === "" ? null : Number(body.departmentId);
  const departmentId = departmentNumber == null ? null : (Number.isInteger(departmentNumber) && departmentNumber > 0 ? departmentNumber : NaN);
  return {
    accountEmail: cleanEmail(body.accountEmail || "") || null,
    staffNumber: clean(body.staffNumber, 40),
    employmentKind,
    lastName,
    firstName,
    patronymic,
    displayName,
    dateOfBirth: clean(body.dateOfBirth, 10),
    militaryRank: clean(body.militaryRank, 100),
    positionTitle: clean(body.positionTitle, 160),
    departmentId,
    workPhone: clean(body.workPhone, 40),
    personalPhone: clean(body.personalPhone, 40),
    workEmail: cleanEmail(body.workEmail),
    alternateEmail: cleanEmail(body.alternateEmail),
    region: clean(body.region, 120),
    city: clean(body.city, 120),
    addressLine: clean(body.addressLine, 240),
    postalCode: clean(body.postalCode, 20),
    active: body.active === false ? 0 : 1,
  };
}

async function validateReferences(
  db: D1Database,
  organizationId: number,
  departmentId: number | null,
  accountEmail: string | null,
  currentId?: string,
) {
  if (departmentId != null) {
    if (!Number.isInteger(departmentId)) return "Некоректний підрозділ";
    const department = await db.prepare(
      "SELECT id FROM departments WHERE id = ? AND organization_id = ? AND active = 1 LIMIT 1",
    ).bind(departmentId, organizationId).first();
    if (!department) return "Підрозділ не належить цій організації або неактивний";
  }
  if (accountEmail) {
    const membership = await db.prepare(
      "SELECT id FROM memberships WHERE organization_id = ? AND member_email = ? LIMIT 1",
    ).bind(organizationId, accountEmail).first();
    if (!membership) return "Обліковий запис не належить цій організації";
    const linked = await db.prepare(
      `SELECT id FROM personnel_records
       WHERE organization_id = ? AND account_email = ? AND (? = '' OR id <> ?)
       LIMIT 1`,
    ).bind(organizationId, accountEmail, currentId || "", currentId || "").first<{ id:string }>();
    if (linked) return "Цей обліковий запис уже пов’язаний з іншим працівником";
  }
  return "";
}

function validationProblem(input: ReturnType<typeof parseInput>) {
  if (!input.lastName || !input.firstName || !input.positionTitle) {
    return "Заповніть прізвище, ім’я та посаду";
  }
  if (!EMPLOYMENT_KINDS.has(input.employmentKind)) return "Некоректний тип персоналу";
  if (!validDate(input.dateOfBirth)) return "Дата народження має бути у форматі РРРР-ММ-ДД";
  if (!validEmail(input.workEmail) || !validEmail(input.alternateEmail)) return "Перевірте e-mail працівника";
  return "";
}

async function requirePersonnelManager(request: Request, db: D1Database) {
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManagePersonnel(ctx.member.role)) return null;
  return ctx;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requirePersonnelManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до кадрового довідника заборонено" }, { status: 403 });

  const [records, departments, accounts] = await Promise.all([
    db.prepare(
      `SELECT p.id, p.account_email AS accountEmail, p.staff_number AS staffNumber,
         p.employment_kind AS employmentKind, p.last_name AS lastName,
         p.first_name AS firstName, p.patronymic, p.display_name AS displayName,
         p.date_of_birth AS dateOfBirth, p.military_rank AS militaryRank,
         p.position_title AS positionTitle, p.department_id AS departmentId,
         d.name AS departmentName, p.work_phone AS workPhone,
         p.personal_phone AS personalPhone, p.work_email AS workEmail,
         p.alternate_email AS alternateEmail, p.region, p.city,
         p.address_line AS addressLine, p.postal_code AS postalCode,
         p.photo_storage_key AS photoStorageKey, p.active,
         p.created_at AS createdAt, p.updated_at AS updatedAt
       FROM personnel_records p
       LEFT JOIN departments d
         ON d.id = p.department_id AND d.organization_id = p.organization_id
       WHERE p.organization_id = ?
       ORDER BY p.active DESC, p.last_name, p.first_name, p.patronymic, p.id`,
    ).bind(ctx.organizationId).all(),
    db.prepare(
      `SELECT id, name, active FROM departments
       WHERE organization_id = ? AND active = 1
       ORDER BY name`,
    ).bind(ctx.organizationId).all(),
    db.prepare(
      `SELECT m.member_email AS email, s.display_name AS displayName,
         s.phone, m.role, m.active
       FROM memberships m
       JOIN staff_members s ON s.email = m.member_email
       WHERE m.organization_id = ?
       ORDER BY m.active DESC, s.display_name, m.member_email`,
    ).bind(ctx.organizationId).all(),
  ]);

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_registry_viewed",
    resource: "personnel",
    details: { count: records.results.length },
  });

  return Response.json(
    { records: records.results, departments: departments.results, accounts: accounts.results },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requirePersonnelManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до кадрового довідника заборонено" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as PersonnelInput;
  const input = parseInput(body);
  const problem = validationProblem(input);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  const referenceProblem = await validateReferences(db, ctx.organizationId, input.departmentId, input.accountEmail);
  if (referenceProblem) return Response.json({ error: referenceProblem }, { status: 409 });

  const id = `personnel-${crypto.randomUUID()}`;
  await db.prepare(
    `INSERT INTO personnel_records (
       id, organization_id, account_email, staff_number, employment_kind,
       last_name, first_name, patronymic, display_name, date_of_birth,
       military_rank, position_title, department_id, work_phone, personal_phone,
       work_email, alternate_email, region, city, address_line, postal_code,
       active, created_by, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, ctx.organizationId, input.accountEmail, input.staffNumber, input.employmentKind,
    input.lastName, input.firstName, input.patronymic, input.displayName, input.dateOfBirth,
    input.militaryRank, input.positionTitle, input.departmentId, input.workPhone, input.personalPhone,
    input.workEmail, input.alternateEmail, input.region, input.city, input.addressLine, input.postalCode,
    input.active, ctx.member.email, ctx.member.email,
  ).run();

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_created",
    resource: "personnel",
    targetId: id,
    details: { hasAccount: Boolean(input.accountEmail), departmentId: input.departmentId, active: Boolean(input.active) },
  });
  return Response.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requirePersonnelManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до кадрового довідника заборонено" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as PersonnelInput;
  const id = clean(body.id, 120);
  if (!id) return Response.json({ error: "Не вказано працівника" }, { status: 400 });
  const existing = await db.prepare(
    "SELECT id FROM personnel_records WHERE id = ? AND organization_id = ? LIMIT 1",
  ).bind(id, ctx.organizationId).first();
  if (!existing) return Response.json({ error: "Працівника не знайдено" }, { status: 404 });

  const input = parseInput(body);
  const problem = validationProblem(input);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  const referenceProblem = await validateReferences(db, ctx.organizationId, input.departmentId, input.accountEmail, id);
  if (referenceProblem) return Response.json({ error: referenceProblem }, { status: 409 });

  await db.prepare(
    `UPDATE personnel_records SET
       account_email = ?, staff_number = ?, employment_kind = ?,
       last_name = ?, first_name = ?, patronymic = ?, display_name = ?,
       date_of_birth = ?, military_rank = ?, position_title = ?, department_id = ?,
       work_phone = ?, personal_phone = ?, work_email = ?, alternate_email = ?,
       region = ?, city = ?, address_line = ?, postal_code = ?, active = ?,
       updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND organization_id = ?`,
  ).bind(
    input.accountEmail, input.staffNumber, input.employmentKind,
    input.lastName, input.firstName, input.patronymic, input.displayName,
    input.dateOfBirth, input.militaryRank, input.positionTitle, input.departmentId,
    input.workPhone, input.personalPhone, input.workEmail, input.alternateEmail,
    input.region, input.city, input.addressLine, input.postalCode, input.active,
    ctx.member.email, id, ctx.organizationId,
  ).run();

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_updated",
    resource: "personnel",
    targetId: id,
    details: { hasAccount: Boolean(input.accountEmail), departmentId: input.departmentId, active: Boolean(input.active) },
  });
  return Response.json({ ok: true, id });
}
