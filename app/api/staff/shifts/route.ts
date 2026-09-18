import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { canViewManagementSummary } from "../../../../lib/staff-auth";
import { requireSelfServiceOrgContext } from "../../../../lib/tenant";
import {
  CALENDAR6_PRESETS,
  SHIFT_OVERRIDE_KINDS,
  datesForMonth,
  isIsoDate,
  isMonthKey,
  resolvePresetShift,
  resolvedOverride,
  shiftCellText,
  shiftPreset,
  type ShiftKind,
  type ShiftOverride,
} from "../../../../lib/shift-calendar";

type PersonRow = {
  personnelId:string;
  email:string;
  accountEmail:string | null;
  displayName:string;
  role:string;
  positionTitle:string;
  militaryRank:string;
  departmentName:string;
};

type AssignmentRow = {
  personnelId:string;
  staffEmail:string;
  presetCode:string;
  teamIndex:number;
  anchorDate:string;
};

type OverrideRow = ShiftOverride & { id:number; personnelId:string };

function clean(value:unknown, max=160) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function timeValue(value:unknown) {
  const result = clean(value, 5);
  return result === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(result) ? result : null;
}

function csvCell(value:unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

async function personnelRows(db:D1Database, organizationId:number, accountEmail:string | null) {
  const sql = `SELECT p.id AS personnelId,
      COALESCE(p.account_email, '') AS email,
      p.account_email AS accountEmail,
      p.display_name AS displayName,
      COALESCE(m.role, '') AS role,
      COALESCE(p.position_title, '') AS positionTitle,
      COALESCE(p.military_rank, '') AS militaryRank,
      COALESCE(d.name, '') AS departmentName
    FROM personnel_records p
    LEFT JOIN memberships m
      ON m.organization_id = p.organization_id
     AND m.member_email = p.account_email
     AND m.active = 1
    LEFT JOIN departments d
      ON d.organization_id = p.organization_id
     AND d.id = p.department_id
    WHERE p.organization_id = ? AND p.active = 1${accountEmail ? " AND p.account_email = ?" : ""}
    ORDER BY p.position_title, p.display_name, p.id`;
  return accountEmail
    ? db.prepare(sql).bind(organizationId, accountEmail).all<PersonRow>()
    : db.prepare(sql).bind(organizationId).all<PersonRow>();
}

async function assignmentRows(db:D1Database, organizationId:number, personnelId:string | null) {
  const sql = `SELECT a.personnel_id AS personnelId,
      COALESCE(p.account_email, '') AS staffEmail,
      a.preset_code AS presetCode, a.team_index AS teamIndex, a.anchor_date AS anchorDate
    FROM personnel_shift_assignments a
    JOIN personnel_records p
      ON p.organization_id = a.organization_id AND p.id = a.personnel_id
    WHERE a.organization_id = ?${personnelId ? " AND a.personnel_id = ?" : ""}
    ORDER BY p.display_name, a.personnel_id`;
  return personnelId
    ? db.prepare(sql).bind(organizationId, personnelId).all<AssignmentRow>()
    : db.prepare(sql).bind(organizationId).all<AssignmentRow>();
}

async function overrideRows(db:D1Database, organizationId:number, month:string, personnelId:string | null) {
  const sql = `SELECT o.id, o.personnel_id AS personnelId,
      COALESCE(p.account_email, '') AS staffEmail,
      o.shift_date AS shiftDate, o.kind, o.label,
      o.start_time AS startTime, o.end_time AS endTime, o.note
    FROM personnel_shift_overrides o
    JOIN personnel_records p
      ON p.organization_id = o.organization_id AND p.id = o.personnel_id
    WHERE o.organization_id = ? AND o.shift_date LIKE ?${personnelId ? " AND o.personnel_id = ?" : ""}
    ORDER BY o.shift_date, p.display_name, o.personnel_id`;
  return personnelId
    ? db.prepare(sql).bind(organizationId, `${month}-%`, personnelId).all<OverrideRow>()
    : db.prepare(sql).bind(organizationId, `${month}-%`).all<OverrideRow>();
}

function buildCsv(month:string, people:PersonRow[], assignments:AssignmentRow[], overrides:OverrideRow[]) {
  const dates = datesForMonth(month);
  const assignmentByPersonnel = new Map(assignments.map((row) => [row.personnelId, row]));
  const overrideByKey = new Map(overrides.map((row) => [`${row.personnelId}:${row.shiftDate}`, row]));
  const header = ["Працівник", "Посада", "Графік", "Бригада", ...dates.map((date) => date.slice(-2))];
  const rows = people.map((person) => {
    const assignment = assignmentByPersonnel.get(person.personnelId);
    const preset = assignment ? shiftPreset(assignment.presetCode) : null;
    const dayCells = dates.map((date) => {
      const override = overrideByKey.get(`${person.personnelId}:${date}`);
      if (override) return shiftCellText(resolvedOverride(override));
      if (!assignment) return "";
      return shiftCellText(resolvePresetShift(assignment.presetCode, assignment.teamIndex, assignment.anchorDate, date));
    });
    return [person.displayName || person.email || person.personnelId, person.positionTitle, preset?.name || "",
      assignment ? String(assignment.teamIndex) : "", ...dayCells];
  });
  return "\ufeff" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
}

async function requestedPersonnel(
  db:D1Database,
  organizationId:number,
  body:Record<string, unknown>,
) {
  const personnelId = clean(body.personnelId, 160);
  const legacyEmail = clean(body.staffEmail, 254).toLowerCase();
  if (!personnelId && !legacyEmail) return null;
  if (personnelId) {
    return db.prepare(
      `SELECT id AS personnelId, account_email AS accountEmail
       FROM personnel_records WHERE organization_id = ? AND id = ? AND active = 1 LIMIT 1`,
    ).bind(organizationId, personnelId).first<{ personnelId:string; accountEmail:string | null }>();
  }
  return db.prepare(
    `SELECT id AS personnelId, account_email AS accountEmail
     FROM personnel_records WHERE organization_id = ? AND account_email = ? AND active = 1 LIMIT 1`,
  ).bind(organizationId, legacyEmail).first<{ personnelId:string; accountEmail:string | null }>();
}

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });

  const url = new URL(request.url);
  const month = url.searchParams.get("month") || currentMonth();
  if (!isMonthKey(month)) return Response.json({ error:"Некоректний місяць" }, { status:400 });
  const canManage = canViewManagementSummary(ctx.member.role);
  const peopleResult = await personnelRows(db, ctx.organizationId, canManage ? null : ctx.member.email);
  const people = peopleResult.results as PersonRow[];
  const ownPersonnelId = canManage ? null : (people[0]?.personnelId || null);
  const [assignmentsResult, overridesResult] = await Promise.all([
    assignmentRows(db, ctx.organizationId, ownPersonnelId),
    overrideRows(db, ctx.organizationId, month, ownPersonnelId),
  ]);
  const assignments = assignmentsResult.results as AssignmentRow[];
  const overrides = overridesResult.results as OverrideRow[];

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"staff_shift_calendar_viewed",
    resource:"staff_shift_calendar",
    details:{ month, scope:canManage ? "organization" : "self", personnelLinked:Boolean(canManage || ownPersonnelId) },
  });

  if (url.searchParams.get("format") === "csv") {
    const csv = buildCsv(month, people, assignments, overrides);
    return new Response(csv, {
      headers:{
        "content-type":"text/csv; charset=utf-8",
        "content-disposition":`attachment; filename="staff-shifts-${month}.csv"`,
        "cache-control":"no-store",
      },
    });
  }

  return Response.json({
    month, canManage, staff:ctx.member, people, assignments, overrides,
    personnelLinked:canManage || Boolean(ownPersonnelId), presets:CALENDAR6_PRESETS, overrideKinds:SHIFT_OVERRIDE_KINDS,
  }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canViewManagementSummary(ctx.member.role)) {
    return Response.json({ error:"Керувати графіком може лише завідувач відділення або адміністратор" }, { status:403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = clean(body.action, 40);
  const personnel = await requestedPersonnel(db, ctx.organizationId, body);
  if (!personnel) return Response.json({ error:"Працівника не знайдено в кадровому довіднику цієї організації" }, { status:404 });
  const personnelId = personnel.personnelId;

  if (action === "assignment") {
    const presetCode = clean(body.presetCode, 40);
    const preset = shiftPreset(presetCode);
    const teamIndex = Number(body.teamIndex);
    const anchorDate = clean(body.anchorDate, 10);
    if (!preset || !Number.isInteger(teamIndex) || teamIndex < 1 || teamIndex > preset.teams.length || !isIsoDate(anchorDate)) {
      return Response.json({ error:"Перевірте тип графіка, бригаду та опорну дату" }, { status:400 });
    }
    await db.prepare(
      `INSERT INTO personnel_shift_assignments
        (organization_id, personnel_id, preset_code, team_index, anchor_date, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id, personnel_id) DO UPDATE SET
         preset_code=excluded.preset_code,
         team_index=excluded.team_index,
         anchor_date=excluded.anchor_date,
         updated_by=excluded.updated_by,
         updated_at=CURRENT_TIMESTAMP`,
    ).bind(ctx.organizationId, personnelId, presetCode, teamIndex, anchorDate, ctx.member.email, ctx.member.email).run();
    await audit(db, {
      organizationId:ctx.organizationId, actorEmail:ctx.member.email,
      action:"staff_shift_assignment_saved", resource:"staff_shift_calendar", targetId:personnelId,
      details:{ presetCode, teamIndex, anchorDate },
    });
    return Response.json({ ok:true, personnelId });
  }

  if (action === "clear_assignment") {
    await db.prepare(
      "DELETE FROM personnel_shift_assignments WHERE organization_id = ? AND personnel_id = ?",
    ).bind(ctx.organizationId, personnelId).run();
    await audit(db, {
      organizationId:ctx.organizationId, actorEmail:ctx.member.email,
      action:"staff_shift_assignment_cleared", resource:"staff_shift_calendar", targetId:personnelId,
    });
    return Response.json({ ok:true, personnelId });
  }

  if (action === "override") {
    const shiftDate = clean(body.shiftDate, 10);
    const kind = clean(body.kind, 20) as ShiftKind;
    const label = clean(body.label, 24);
    const startTime = timeValue(body.startTime);
    const endTime = timeValue(body.endTime);
    const note = clean(body.note, 240);
    const validKind = SHIFT_OVERRIDE_KINDS.some((item) => item.value === kind);
    if (!isIsoDate(shiftDate) || !validKind || startTime === null || endTime === null) {
      return Response.json({ error:"Перевірте дату, тип і час персональної зміни" }, { status:400 });
    }
    const assignment = await db.prepare(
      "SELECT 1 AS ok FROM personnel_shift_assignments WHERE organization_id = ? AND personnel_id = ? LIMIT 1",
    ).bind(ctx.organizationId, personnelId).first<{ ok:number }>();
    if (!assignment) return Response.json({ error:"Спочатку призначте працівнику базовий графік чергувань" }, { status:409 });
    await db.prepare(
      `INSERT INTO personnel_shift_overrides
        (organization_id, personnel_id, shift_date, kind, label, start_time, end_time, note, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id, personnel_id, shift_date) DO UPDATE SET
         kind=excluded.kind, label=excluded.label, start_time=excluded.start_time,
         end_time=excluded.end_time, note=excluded.note,
         updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`,
    ).bind(ctx.organizationId, personnelId, shiftDate, kind, label, startTime, endTime, note, ctx.member.email, ctx.member.email).run();
    await audit(db, {
      organizationId:ctx.organizationId, actorEmail:ctx.member.email,
      action:"staff_shift_override_saved", resource:"staff_shift_calendar", targetId:personnelId,
      details:{ shiftDate, kind },
    });
    return Response.json({ ok:true, personnelId });
  }

  if (action === "clear_override") {
    const shiftDate = clean(body.shiftDate, 10);
    if (!isIsoDate(shiftDate)) return Response.json({ error:"Некоректна дата" }, { status:400 });
    await db.prepare(
      "DELETE FROM personnel_shift_overrides WHERE organization_id = ? AND personnel_id = ? AND shift_date = ?",
    ).bind(ctx.organizationId, personnelId, shiftDate).run();
    await audit(db, {
      organizationId:ctx.organizationId, actorEmail:ctx.member.email,
      action:"staff_shift_override_cleared", resource:"staff_shift_calendar", targetId:personnelId,
      details:{ shiftDate },
    });
    return Response.json({ ok:true, personnelId });
  }

  return Response.json({ error:"Невідома дія" }, { status:400 });
}