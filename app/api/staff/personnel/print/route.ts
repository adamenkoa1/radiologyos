// Друкована кадрова картка — immutable, версійований snapshot.
// Payload самодостатній (усі значення, не лише id), тож форма відтворювана з
// конкретного snapshot навіть після зміни довідників чи самої картки. Кадрова
// картка НЕ є господарським документом, тож зберігається в окремій таблиці
// personnel_card_snapshots (рядковий personnel_id, без FK на business_documents).
import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";
import type { AccessRole } from "../../../../../lib/staff-auth";

const FORM_TYPE = "personnel_card";
const TEMPLATE_VERSION = 1;

function canManagePersonnel(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type SnapshotRow = { id:number; templateVersion:number; sha256:string; generatedBy:string; generatedAt:string };

async function renderPayload(db: D1Database, organizationId: number, personnelId: string) {
  const record = await db.prepare(
    `SELECT p.id, p.staff_number AS staffNumber, p.employment_kind AS employmentKind,
       p.last_name AS lastName, p.first_name AS firstName, p.patronymic,
       p.display_name AS displayName, p.date_of_birth AS dateOfBirth,
       p.military_rank AS militaryRank, p.position_title AS positionTitle,
       p.department_id AS departmentId, d.name AS departmentName,
       p.work_phone AS workPhone, p.personal_phone AS personalPhone,
       p.work_email AS workEmail, p.alternate_email AS alternateEmail,
       p.region, p.city, p.address_line AS addressLine, p.postal_code AS postalCode,
       p.account_email AS accountEmail, p.active
     FROM personnel_records p
     LEFT JOIN departments d ON d.id = p.department_id AND d.organization_id = p.organization_id
     WHERE p.organization_id = ? AND p.id = ?`,
  ).bind(organizationId, personnelId).first<Record<string, unknown>>();
  if (!record) return null;

  const assignments = await db.prepare(
    `SELECT a.position_title AS positionTitle, a.assignment_kind AS assignmentKind,
       a.duties, a.starts_on AS startsOn, a.ends_on AS endsOn,
       a.order_reference AS orderReference, d.name AS departmentName,
       parent.name AS parentDepartmentName
     FROM personnel_assignments a
     LEFT JOIN departments d ON d.id = a.department_id AND d.organization_id = a.organization_id
     LEFT JOIN department_structure ds ON ds.department_id = a.department_id AND ds.organization_id = a.organization_id
     LEFT JOIN departments parent ON parent.id = ds.parent_department_id AND parent.organization_id = a.organization_id
     WHERE a.organization_id = ? AND a.personnel_id = ?
     ORDER BY CASE WHEN a.ends_on = '' THEN 0 ELSE 1 END,
       CASE a.assignment_kind WHEN 'primary' THEN 0 WHEN 'acting' THEN 1 ELSE 2 END,
       a.starts_on DESC, a.created_at DESC`,
  ).bind(organizationId, personnelId).all<Record<string, unknown>>();

  const schedule = await db.prepare(
    `SELECT id, name, schedule_kind AS scheduleKind, valid_from AS validFrom,
       valid_to AS validTo, weekly_minutes AS weeklyMinutes, note
     FROM personnel_work_schedules
     WHERE organization_id = ? AND personnel_id = ?
     ORDER BY active DESC, valid_to = '' DESC, valid_from DESC, created_at DESC
     LIMIT 1`,
  ).bind(organizationId, personnelId).first<Record<string, unknown>>();
  let scheduleDays: Record<string, unknown>[] = [];
  if (schedule) {
    const days = await db.prepare(
      `SELECT weekday, is_working AS isWorking, start_time AS startTime,
         end_time AS endTime, break_start AS breakStart, break_end AS breakEnd
       FROM personnel_work_schedule_days
       WHERE organization_id = ? AND schedule_id = ?
       ORDER BY weekday`,
    ).bind(organizationId, schedule.id).all<Record<string, unknown>>();
    scheduleDays = days.results || [];
  }

  const org = await db.prepare(
    `SELECT name FROM organizations WHERE id = ?`,
  ).bind(organizationId).first<{ name:string }>();

  // Стабільний порядок ключів → відтворюваний JSON → стабільний SHA-256.
  return {
    formType: FORM_TYPE,
    templateVersion: TEMPLATE_VERSION,
    organization: { name: org?.name || "" },
    record,
    assignments: assignments.results || [],
    schedule: schedule ? { ...schedule, days: scheduleDays } : null,
  };
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canManagePersonnel(ctx.member.role)) {
    return Response.json({ error: "Друкувати кадрову картку може лише адміністратор або керівник підрозділу" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as { personnelId?: unknown };
  const personnelId = String(body.personnelId ?? "").trim();
  if (!personnelId) return Response.json({ error: "Не вказано працівника" }, { status: 400 });

  const payload = await renderPayload(db, ctx.organizationId, personnelId);
  if (!payload) return Response.json({ error: "Картку працівника не знайдено" }, { status: 404 });

  const payloadJson = JSON.stringify(payload);
  const hash = await sha256(payloadJson);
  // Ідемпотентно: однаковий рендер згортається в один рядок (unique same_render).
  await db.prepare(
    `INSERT OR IGNORE INTO personnel_card_snapshots
       (organization_id, personnel_id, template_version, payload_json, sha256, generated_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(ctx.organizationId, personnelId, TEMPLATE_VERSION, payloadJson, hash, ctx.member.email).run();

  const snapshot = await db.prepare(
    `SELECT id, template_version AS templateVersion, sha256, generated_by AS generatedBy, generated_at AS generatedAt
     FROM personnel_card_snapshots
     WHERE organization_id = ? AND personnel_id = ? AND template_version = ? AND sha256 = ?`,
  ).bind(ctx.organizationId, personnelId, TEMPLATE_VERSION, hash).first<SnapshotRow>();

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_card_printed",
    resource: "personnel_card_snapshot",
    targetId: personnelId,
    details: { snapshotId: snapshot?.id, templateVersion: TEMPLATE_VERSION },
  });

  return Response.json({ snapshot, payload });
}
