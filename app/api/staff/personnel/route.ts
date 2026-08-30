import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { requireSelfServiceOrgContext } from "../../../../lib/tenant";
import type { AccessRole } from "../../../../lib/staff-auth";

const EMPLOYMENT_KINDS = new Set(["unspecified", "military", "civilian", "contractor", "other"]);
const ASSIGNMENT_KINDS = new Set(["primary", "acting", "secondary", "temporary", "other"]);
const SCHEDULE_KINDS = new Set(["five_day", "six_day", "shift", "individual", "other"]);

function canManagePersonnel(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function clean(value: unknown, max = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanMultiline(value: unknown, max = 4000) {
  return String(value ?? "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function cleanEmail(value: unknown) {
  return clean(value, 254).toLowerCase();
}

function validEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validRequiredDate(value: string) {
  return Boolean(value) && validDate(value);
}

function validTime(value: string) {
  return value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseDepartmentId(value: unknown) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : NaN;
}

function minutesOfDay(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function workingMinutes(start: string, end: string, breakStart: string, breakEnd: string) {
  let finish = minutesOfDay(end);
  const begin = minutesOfDay(start);
  if (finish <= begin) finish += 1440;
  let result = finish - begin;
  if (breakStart && breakEnd) {
    let breakFinish = minutesOfDay(breakEnd);
    const breakBegin = minutesOfDay(breakStart);
    if (breakFinish <= breakBegin) breakFinish += 1440;
    result -= Math.max(0, breakFinish - breakBegin);
  }
  return Math.max(0, result);
}

type PersonnelInput = {
  id?: string;
  action?: string;
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

type AssignmentInput = {
  action?: string;
  assignmentId?: string;
  personnelId?: string;
  departmentId?: number | string | null;
  positionTitle?: string;
  assignmentKind?: string;
  duties?: string;
  startsOn?: string;
  endsOn?: string;
  orderReference?: string;
};

type WorkScheduleDayInput = {
  weekday?: number;
  isWorking?: boolean;
  startTime?: string;
  endTime?: string;
  breakStart?: string;
  breakEnd?: string;
};

type WorkScheduleInput = {
  action?: string;
  scheduleId?: string;
  personnelId?: string;
  name?: string;
  scheduleKind?: string;
  validFrom?: string;
  validTo?: string;
  note?: string;
  active?: boolean;
  days?: WorkScheduleDayInput[];
};

function parseInput(body: PersonnelInput) {
  const lastName = clean(body.lastName, 80);
  const firstName = clean(body.firstName, 80);
  const patronymic = clean(body.patronymic, 80);
  const displayName = [lastName, firstName, patronymic].filter(Boolean).join(" ").slice(0, 240);
  const employmentKind = clean(body.employmentKind || "unspecified", 24);
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
    departmentId: parseDepartmentId(body.departmentId),
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

async function personnelInOrganization(db: D1Database, organizationId: number, personnelId: string) {
  return db.prepare(
    `SELECT id, position_title AS positionTitle, department_id AS departmentId
     FROM personnel_records WHERE id = ? AND organization_id = ? LIMIT 1`,
  ).bind(personnelId, organizationId).first<{ id:string; positionTitle:string; departmentId:number | null }>();
}

async function validateDepartment(db: D1Database, organizationId: number, departmentId: number | null) {
  if (departmentId == null) return "";
  if (!Number.isInteger(departmentId)) return "Некоректний підрозділ";
  const department = await db.prepare(
    "SELECT id FROM departments WHERE id = ? AND organization_id = ? AND active = 1 LIMIT 1",
  ).bind(departmentId, organizationId).first();
  return department ? "" : "Підрозділ не належить цій організації або неактивний";
}

async function validateReferences(
  db: D1Database,
  organizationId: number,
  departmentId: number | null,
  accountEmail: string | null,
  currentId?: string,
) {
  const departmentProblem = await validateDepartment(db, organizationId, departmentId);
  if (departmentProblem) return departmentProblem;
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

async function saveAssignment(request: Request, db: D1Database, ctx: Awaited<ReturnType<typeof requirePersonnelManager>>) {
  if (!ctx) return Response.json({ error:"Доступ до кадрового довідника заборонено" }, { status:403 });
  const body = await request.json().catch(() => ({})) as AssignmentInput;
  const personnelId = clean(body.personnelId, 120);
  const assignmentId = clean(body.assignmentId, 160);
  const departmentId = parseDepartmentId(body.departmentId);
  const positionTitle = clean(body.positionTitle, 160);
  const assignmentKind = clean(body.assignmentKind || "primary", 24);
  const duties = cleanMultiline(body.duties, 4000);
  const startsOn = clean(body.startsOn, 10);
  const endsOn = clean(body.endsOn, 10);
  const orderReference = clean(body.orderReference, 240);

  if (!personnelId || !positionTitle || !ASSIGNMENT_KINDS.has(assignmentKind)) {
    return Response.json({ error:"Вкажіть працівника, посаду та тип призначення" }, { status:400 });
  }
  if (!validDate(startsOn) || !validDate(endsOn) || (startsOn && endsOn && endsOn < startsOn)) {
    return Response.json({ error:"Перевірте дати призначення" }, { status:400 });
  }
  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error:"Працівника не знайдено" }, { status:404 });
  const departmentProblem = await validateDepartment(db, ctx.organizationId, departmentId);
  if (departmentProblem) return Response.json({ error:departmentProblem }, { status:409 });

  let id = assignmentId;
  try {
    if (assignmentId) {
      const existing = await db.prepare(
        "SELECT id FROM personnel_assignments WHERE id = ? AND organization_id = ? AND personnel_id = ? LIMIT 1",
      ).bind(assignmentId, ctx.organizationId, personnelId).first();
      if (!existing) return Response.json({ error:"Призначення не знайдено" }, { status:404 });
      await db.prepare(
        `UPDATE personnel_assignments SET department_id = ?, position_title = ?, assignment_kind = ?,
           duties = ?, starts_on = ?, ends_on = ?, order_reference = ?,
           updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND organization_id = ? AND personnel_id = ?`,
      ).bind(
        departmentId, positionTitle, assignmentKind, duties, startsOn, endsOn, orderReference,
        ctx.member.email, assignmentId, ctx.organizationId, personnelId,
      ).run();
    } else {
      id = `assignment-${crypto.randomUUID()}`;
      await db.prepare(
        `INSERT INTO personnel_assignments
         (id, organization_id, personnel_id, department_id, position_title, assignment_kind,
          duties, starts_on, ends_on, order_reference, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, ctx.organizationId, personnelId, departmentId, positionTitle, assignmentKind,
        duties, startsOn, endsOn, orderReference, ctx.member.email, ctx.member.email,
      ).run();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/personnel_assignment_scope/i.test(message)) {
      return Response.json({ error:"Призначення не належить цій організації" }, { status:409 });
    }
    if (/personnel_assignments_current_primary_idx|UNIQUE constraint failed: personnel_assignments\.organization_id, personnel_assignments\.personnel_id/i.test(message)) {
      return Response.json({ error:"У працівника вже є чинне основне призначення. Відредагуйте його або вкажіть дату завершення." }, { status:409 });
    }
    throw error;
  }

  if (assignmentKind === "primary" && !endsOn) {
    await db.prepare(
      `UPDATE personnel_records SET position_title = ?, department_id = ?,
         updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ?`,
    ).bind(positionTitle, departmentId, ctx.member.email, personnelId, ctx.organizationId).run();
  }

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:assignmentId ? "personnel_assignment_updated" : "personnel_assignment_created",
    resource:"personnel_assignment",
    targetId:personnelId,
    details:{ assignmentId:id, assignmentKind, departmentId, hasEndDate:Boolean(endsOn) },
  });
  return Response.json({ ok:true, id }, { status:assignmentId ? 200 : 201 });
}

function parseScheduleDays(value: unknown) {
  if (!Array.isArray(value) || value.length !== 7) return { error:"Графік має містити всі 7 днів тижня", days:[] as Required<WorkScheduleDayInput>[] };
  const seen = new Set<number>();
  const days:Required<WorkScheduleDayInput>[] = [];
  for (const item of value as WorkScheduleDayInput[]) {
    const weekday = Number(item.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || seen.has(weekday)) {
      return { error:"У графіку дублюються або відсутні дні тижня", days:[] as Required<WorkScheduleDayInput>[] };
    }
    seen.add(weekday);
    const isWorking = Boolean(item.isWorking);
    const startTime = clean(item.startTime, 5);
    const endTime = clean(item.endTime, 5);
    const breakStart = clean(item.breakStart, 5);
    const breakEnd = clean(item.breakEnd, 5);
    if (![startTime, endTime, breakStart, breakEnd].every(validTime)) {
      return { error:"Перевірте час у графіку роботи", days:[] as Required<WorkScheduleDayInput>[] };
    }
    if (isWorking && (!startTime || !endTime)) {
      return { error:"Для робочого дня вкажіть початок і завершення роботи", days:[] as Required<WorkScheduleDayInput>[] };
    }
    if (!isWorking && (startTime || endTime || breakStart || breakEnd)) {
      return { error:"Для вихідного дня час має бути порожнім", days:[] as Required<WorkScheduleDayInput>[] };
    }
    if ((breakStart && !breakEnd) || (!breakStart && breakEnd)) {
      return { error:"Перерву потрібно вказати повністю", days:[] as Required<WorkScheduleDayInput>[] };
    }
    days.push({ weekday, isWorking, startTime, endTime, breakStart, breakEnd });
  }
  days.sort((a,b) => a.weekday - b.weekday);
  return { error:"", days };
}

async function saveWorkSchedule(request: Request, db: D1Database, ctx: Awaited<ReturnType<typeof requirePersonnelManager>>) {
  if (!ctx) return Response.json({ error:"Доступ до кадрового довідника заборонено" }, { status:403 });
  const body = await request.json().catch(() => ({})) as WorkScheduleInput;
  const personnelId = clean(body.personnelId, 120);
  const scheduleId = clean(body.scheduleId, 160);
  const name = clean(body.name, 160);
  const scheduleKind = clean(body.scheduleKind || "individual", 24);
  const validFrom = clean(body.validFrom, 10);
  const validTo = clean(body.validTo, 10);
  const note = cleanMultiline(body.note, 1000);
  const active = body.active === false ? 0 : 1;
  const parsedDays = parseScheduleDays(body.days);

  if (!personnelId || !name || !SCHEDULE_KINDS.has(scheduleKind) || !validRequiredDate(validFrom)) {
    return Response.json({ error:"Вкажіть працівника, назву, тип і дату початку дії графіка" }, { status:400 });
  }
  if (!validDate(validTo) || (validTo && validTo < validFrom)) {
    return Response.json({ error:"Перевірте строк дії графіка" }, { status:400 });
  }
  if (parsedDays.error) return Response.json({ error:parsedDays.error }, { status:400 });
  const personnel = await personnelInOrganization(db, ctx.organizationId, personnelId);
  if (!personnel) return Response.json({ error:"Працівника не знайдено" }, { status:404 });

  const weeklyMinutes = parsedDays.days.reduce((sum, day) => {
    if (!day.isWorking) return sum;
    return sum + workingMinutes(day.startTime, day.endTime, day.breakStart, day.breakEnd);
  }, 0);
  if (weeklyMinutes > 10080) return Response.json({ error:"Некоректна тривалість робочого тижня" }, { status:400 });

  let id = scheduleId;
  if (scheduleId) {
    const existing = await db.prepare(
      "SELECT id FROM personnel_work_schedules WHERE id = ? AND organization_id = ? AND personnel_id = ? LIMIT 1",
    ).bind(scheduleId, ctx.organizationId, personnelId).first();
    if (!existing) return Response.json({ error:"Графік роботи не знайдено" }, { status:404 });
  } else {
    id = `work-schedule-${crypto.randomUUID()}`;
  }

  const statements = [];
  if (scheduleId) {
    statements.push(db.prepare(
      `UPDATE personnel_work_schedules SET name = ?, schedule_kind = ?, valid_from = ?, valid_to = ?,
         weekly_minutes = ?, note = ?, active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ? AND personnel_id = ?`,
    ).bind(name, scheduleKind, validFrom, validTo, weeklyMinutes, note, active, ctx.member.email, id, ctx.organizationId, personnelId));
    statements.push(db.prepare(
      "DELETE FROM personnel_work_schedule_days WHERE schedule_id = ? AND organization_id = ?",
    ).bind(id, ctx.organizationId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO personnel_work_schedules
       (id, organization_id, personnel_id, name, schedule_kind, valid_from, valid_to,
        weekly_minutes, note, active, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, ctx.organizationId, personnelId, name, scheduleKind, validFrom, validTo,
      weeklyMinutes, note, active, ctx.member.email, ctx.member.email));
  }
  for (const day of parsedDays.days) {
    statements.push(db.prepare(
      `INSERT INTO personnel_work_schedule_days
       (schedule_id, organization_id, weekday, is_working, start_time, end_time, break_start, break_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, ctx.organizationId, day.weekday, day.isWorking ? 1 : 0,
      day.startTime, day.endTime, day.breakStart, day.breakEnd));
  }

  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/personnel_work_schedule_(scope|day_scope)/i.test(message)) {
      return Response.json({ error:"Графік роботи не належить цій організації" }, { status:409 });
    }
    if (/personnel_work_schedules_current_idx|UNIQUE constraint failed: personnel_work_schedules\.organization_id, personnel_work_schedules\.personnel_id/i.test(message)) {
      return Response.json({ error:"У працівника вже є чинний графік без дати завершення. Відредагуйте його або завершіть попередній." }, { status:409 });
    }
    throw error;
  }

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:scheduleId ? "personnel_work_schedule_updated" : "personnel_work_schedule_created",
    resource:"personnel_work_schedule",
    targetId:personnelId,
    details:{ scheduleId:id, scheduleKind, weeklyMinutes, active:Boolean(active), hasEndDate:Boolean(validTo) },
  });
  return Response.json({ ok:true, id, weeklyMinutes }, { status:scheduleId ? 200 : 201 });
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requirePersonnelManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до кадрового довідника заборонено" }, { status: 403 });

  const [records, departments, accounts, structure, assignments, workSchedules, workScheduleDays] = await Promise.all([
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
         p.created_at AS createdAt, p.updated_at AS updatedAt,
         (SELECT v.decision_code FROM personnel_vlk_records v
          WHERE v.organization_id = p.organization_id AND v.personnel_id = p.id
            AND NOT EXISTS (
              SELECT 1 FROM personnel_vlk_records correction
              WHERE correction.supersedes_id = v.id
            )
          ORDER BY v.examination_date DESC, v.created_at DESC, v.id DESC LIMIT 1) AS vlkDecisionCode,
         (SELECT v.valid_until FROM personnel_vlk_records v
          WHERE v.organization_id = p.organization_id AND v.personnel_id = p.id
            AND NOT EXISTS (
              SELECT 1 FROM personnel_vlk_records correction
              WHERE correction.supersedes_id = v.id
            )
          ORDER BY v.examination_date DESC, v.created_at DESC, v.id DESC LIMIT 1) AS vlkValidUntil
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
    db.prepare(
      `SELECT d.id AS departmentId, d.name AS departmentName,
         ds.parent_department_id AS parentDepartmentId, parent.name AS parentDepartmentName,
         COALESCE(ds.unit_type, 'unit') AS unitType
       FROM departments d
       LEFT JOIN department_structure ds
         ON ds.organization_id = d.organization_id AND ds.department_id = d.id
       LEFT JOIN departments parent
         ON parent.organization_id = d.organization_id AND parent.id = ds.parent_department_id
       WHERE d.organization_id = ? AND d.active = 1
       ORDER BY COALESCE(parent.name, d.name), ds.parent_department_id IS NOT NULL, d.name`,
    ).bind(ctx.organizationId).all(),
    db.prepare(
      `SELECT a.id, a.personnel_id AS personnelId, a.department_id AS departmentId,
         d.name AS departmentName, ds.parent_department_id AS parentDepartmentId,
         parent.name AS parentDepartmentName, a.position_title AS positionTitle,
         a.assignment_kind AS assignmentKind, a.duties, a.starts_on AS startsOn,
         a.ends_on AS endsOn, a.order_reference AS orderReference,
         a.created_at AS createdAt, a.updated_at AS updatedAt
       FROM personnel_assignments a
       LEFT JOIN departments d
         ON d.id = a.department_id AND d.organization_id = a.organization_id
       LEFT JOIN department_structure ds
         ON ds.department_id = a.department_id AND ds.organization_id = a.organization_id
       LEFT JOIN departments parent
         ON parent.id = ds.parent_department_id AND parent.organization_id = a.organization_id
       WHERE a.organization_id = ?
       ORDER BY a.personnel_id, CASE WHEN a.ends_on = '' THEN 0 ELSE 1 END,
         CASE a.assignment_kind WHEN 'primary' THEN 0 WHEN 'acting' THEN 1 ELSE 2 END,
         a.starts_on DESC, a.created_at DESC`,
    ).bind(ctx.organizationId).all(),
    db.prepare(
      `SELECT id, personnel_id AS personnelId, name, schedule_kind AS scheduleKind,
         valid_from AS validFrom, valid_to AS validTo, weekly_minutes AS weeklyMinutes,
         note, active, created_at AS createdAt, updated_at AS updatedAt
       FROM personnel_work_schedules
       WHERE organization_id = ?
       ORDER BY personnel_id, active DESC, valid_to = '' DESC, valid_from DESC, created_at DESC`,
    ).bind(ctx.organizationId).all(),
    db.prepare(
      `SELECT d.schedule_id AS scheduleId, d.weekday, d.is_working AS isWorking,
         d.start_time AS startTime, d.end_time AS endTime,
         d.break_start AS breakStart, d.break_end AS breakEnd
       FROM personnel_work_schedule_days d
       JOIN personnel_work_schedules s ON s.id = d.schedule_id
       WHERE d.organization_id = ? AND s.organization_id = ?
       ORDER BY d.schedule_id, d.weekday`,
    ).bind(ctx.organizationId, ctx.organizationId).all(),
  ]);

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_registry_viewed",
    resource: "personnel",
    details: { count: records.results.length },
  });

  return Response.json(
    {
      records: records.results,
      departments: departments.results,
      accounts: accounts.results,
      departmentStructure: structure.results,
      assignments: assignments.results,
      workSchedules: workSchedules.results,
      workScheduleDays: workScheduleDays.results,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requirePersonnelManager(request, db);
  if (!ctx) return Response.json({ error: "Доступ до кадрового довідника заборонено" }, { status: 403 });

  const probe = await request.clone().json().catch(() => ({})) as { action?:string };
  const action = clean(probe.action, 40);
  if (action === "assignment") return saveAssignment(request, db, ctx);
  if (action === "work_schedule") return saveWorkSchedule(request, db, ctx);

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

  const assignmentId = `assignment-${crypto.randomUUID()}`;
  await db.prepare(
    `INSERT INTO personnel_assignments
     (id, organization_id, personnel_id, department_id, position_title, assignment_kind,
      duties, starts_on, ends_on, order_reference, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, 'primary', '', ?, '', '', ?, ?)`,
  ).bind(
    assignmentId, ctx.organizationId, id, input.departmentId, input.positionTitle,
    new Date().toISOString().slice(0, 10), ctx.member.email, ctx.member.email,
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