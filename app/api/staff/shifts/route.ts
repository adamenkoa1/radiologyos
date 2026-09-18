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
  email:string;
  displayName:string;
  role:string;
  positionTitle:string;
  militaryRank:string;
};

type AssignmentRow = {
  staffEmail:string;
  presetCode:string;
  teamIndex:number;
  anchorDate:string;
};

type OverrideRow = ShiftOverride & { id:number };

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

async function staffRows(db:D1Database, organizationId:number, email:string | null) {
  const sql = `SELECT s.email, s.display_name AS displayName, m.role AS role,
      COALESCE(s.position_title, '') AS positionTitle,
      COALESCE(s.military_rank, '') AS militaryRank
    FROM memberships m
    JOIN staff_members s ON s.email = m.member_email AND s.active = 1
    WHERE m.organization_id = ? AND m.active = 1${email ? " AND s.email = ?" : ""}
    ORDER BY s.position_title, s.display_name, s.email`;
  return email
    ? db.prepare(sql).bind(organizationId, email).all<PersonRow>()
    : db.prepare(sql).bind(organizationId).all<PersonRow>();
}

async function assignmentRows(db:D1Database, organizationId:number, email:string | null) {
  const sql = `SELECT staff_email AS staffEmail, preset_code AS presetCode,
      team_index AS teamIndex, anchor_date AS anchorDate
    FROM staff_shift_assignments
    WHERE organization_id = ?${email ? " AND staff_email = ?" : ""}
    ORDER BY staff_email`;
  return email
    ? db.prepare(sql).bind(organizationId, email).all<AssignmentRow>()
    : db.prepare(sql).bind(organizationId).all<AssignmentRow>();
}

async function overrideRows(db:D1Database, organizationId:number, month:string, email:string | null) {
  const sql = `SELECT id, staff_email AS staffEmail, shift_date AS shiftDate, kind,
      label, start_time AS startTime, end_time AS endTime, note
    FROM staff_shift_overrides
    WHERE organization_id = ? AND shift_date LIKE ?${email ? " AND staff_email = ?" : ""}
    ORDER BY shift_date, staff_email`;
  return email
    ? db.prepare(sql).bind(organizationId, `${month}-%`, email).all<OverrideRow>()
    : db.prepare(sql).bind(organizationId, `${month}-%`).all<OverrideRow>();
}

function buildCsv(
  month:string,
  people:PersonRow[],
  assignments:AssignmentRow[],
  overrides:OverrideRow[],
) {
  const dates = datesForMonth(month);
  const assignmentByEmail = new Map(assignments.map((row) => [row.staffEmail, row]));
  const overrideByKey = new Map(overrides.map((row) => [`${row.staffEmail}:${row.shiftDate}`, row]));
  const header = ["Працівник", "Посада", "Графік", "Бригада", ...dates.map((date) => date.slice(-2))];
  const rows = people.map((person) => {
    const assignment = assignmentByEmail.get(person.email);
    const preset = assignment ? shiftPreset(assignment.presetCode) : null;
    const dayCells = dates.map((date) => {
      const override = overrideByKey.get(`${person.email}:${date}`);
      if (override) return shiftCellText(resolvedOverride(override));
      if (!assignment) return "";
      return shiftCellText(resolvePresetShift(assignment.presetCode, assignment.teamIndex, assignment.anchorDate, date));
    });
    return [
      person.displayName || person.email,
      person.positionTitle,
      preset?.name || "",
      assignment ? String(assignment.teamIndex) : "",
      ...dayCells,
    ];
  });
  return "\ufeff" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
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
  const ownOnly = canManage ? null : ctx.member.email;
  const [peopleResult, assignmentsResult, overridesResult] = await Promise.all([
    staffRows(db, ctx.organizationId, ownOnly),
    assignmentRows(db, ctx.organizationId, ownOnly),
    overrideRows(db, ctx.organizationId, month, ownOnly),
  ]);
  const people = peopleResult.results as PersonRow[];
  const assignments = assignmentsResult.results as AssignmentRow[];
  const overrides = overridesResult.results as OverrideRow[];

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"staff_shift_calendar_viewed",
    resource:"staff_shift_calendar",
    details:{ month, scope:canManage ? "organization" : "self" },
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
    month,
    canManage,
    staff:ctx.member,
    people,
    assignments,
    overrides,
    presets:CALENDAR6_PRESETS,
    overrideKinds:SHIFT_OVERRIDE_KINDS,
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
  const staffEmail = clean(body.staffEmail, 254).toLowerCase();
  if (!staffEmail) return Response.json({ error:"Оберіть працівника" }, { status:400 });

  const member = await db.prepare(
    `SELECT 1 AS ok FROM memberships m
     JOIN staff_members s ON s.email = m.member_email AND s.active = 1
     WHERE m.organization_id = ? AND m.member_email = ? AND m.active = 1 LIMIT 1`
  ).bind(ctx.organizationId, staffEmail).first<{ ok:number }>();
  if (!member) return Response.json({ error:"Працівника не знайдено в цій організації" }, { status:404 });

  if (action === "assignment") {
    const presetCode = clean(body.presetCode, 40);
    const preset = shiftPreset(presetCode);
    const teamIndex = Number(body.teamIndex);
    const anchorDate = clean(body.anchorDate, 10);
    if (!preset || !Number.isInteger(teamIndex) || teamIndex < 1 || teamIndex > preset.teams.length || !isIsoDate(anchorDate)) {
      return Response.json({ error:"Перевірте тип графіка, бригаду та опорну дату" }, { status:400 });
    }
    await db.prepare(
      `INSERT INTO staff_shift_assignments
        (organization_id, staff_email, preset_code, team_index, anchor_date, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id, staff_email) DO UPDATE SET
         preset_code=excluded.preset_code,
         team_index=excluded.team_index,
         anchor_date=excluded.anchor_date,
         updated_by=excluded.updated_by,
         updated_at=CURRENT_TIMESTAMP`
    ).bind(
      ctx.organizationId, staffEmail, presetCode, teamIndex, anchorDate,
      ctx.member.email, ctx.member.email,
    ).run();
    await audit(db, {
      organizationId:ctx.organizationId,
      actorEmail:ctx.member.email,
      action:"staff_shift_assignment_saved",
      resource:"staff_shift_calendar",
      targetId:staffEmail,
      details:{ presetCode, teamIndex, anchorDate },
    });
    return Response.json({ ok:true });
  }

  if (action === "clear_assignment") {
    await db.prepare(
      "DELETE FROM staff_shift_assignments WHERE organization_id = ? AND staff_email = ?"
    ).bind(ctx.organizationId, staffEmail).run();
    await audit(db, {
      organizationId:ctx.organizationId,
      actorEmail:ctx.member.email,
      action:"staff_shift_assignment_cleared",
      resource:"staff_shift_calendar",
      targetId:staffEmail,
    });
    return Response.json({ ok:true });
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
      "SELECT 1 AS ok FROM staff_shift_assignments WHERE organization_id = ? AND staff_email = ? LIMIT 1"
    ).bind(ctx.organizationId, staffEmail).first<{ ok:number }>();
    if (!assignment) return Response.json({ error:"Спочатку призначте працівнику базовий графік" }, { status:409 });
    await db.prepare(
      `INSERT INTO staff_shift_overrides
        (organization_id, staff_email, shift_date, kind, label, start_time, end_time, note, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id, staff_email, shift_date) DO UPDATE SET
         kind=excluded.kind,
         label=excluded.label,
         start_time=excluded.start_time,
         end_time=excluded.end_time,
         note=excluded.note,
         updated_by=excluded.updated_by,
         updated_at=CURRENT_TIMESTAMP`
    ).bind(
      ctx.organizationId, staffEmail, shiftDate, kind, label, startTime, endTime, note,
      ctx.member.email, ctx.member.email,
    ).run();
    await audit(db, {
      organizationId:ctx.organizationId,
      actorEmail:ctx.member.email,
      action:"staff_shift_override_saved",
      resource:"staff_shift_calendar",
      targetId:staffEmail,
      details:{ shiftDate, kind },
    });
    return Response.json({ ok:true });
  }

  if (action === "clear_override") {
    const shiftDate = clean(body.shiftDate, 10);
    if (!isIsoDate(shiftDate)) return Response.json({ error:"Некоректна дата" }, { status:400 });
    await db.prepare(
      "DELETE FROM staff_shift_overrides WHERE organization_id = ? AND staff_email = ? AND shift_date = ?"
    ).bind(ctx.organizationId, staffEmail, shiftDate).run();
    await audit(db, {
      organizationId:ctx.organizationId,
      actorEmail:ctx.member.email,
      action:"staff_shift_override_cleared",
      resource:"staff_shift_calendar",
      targetId:staffEmail,
      details:{ shiftDate },
    });
    return Response.json({ ok:true });
  }

  return Response.json({ error:"Невідома дія" }, { status:400 });
}
