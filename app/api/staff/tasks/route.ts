import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { requireOrgContext } from "../../../../lib/tenant";

type TaskRow = {
  id:number;
  title:string;
  details:string;
  status:"open"|"done";
  priority:"low"|"normal"|"high";
  dueDate:string;
  bookingId:number|null;
  assignedEmail:string;
  createdBy:string;
  completedBy:string;
  completedAt:string;
  createdAt:string;
  updatedAt:string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(["low","normal","high"]);

async function activeMember(db:D1Database, organizationId:number, email:string) {
  if (!email) return true;
  const row = await db.prepare(
    `SELECT 1 AS ok FROM memberships m
     JOIN staff_members s ON s.email = m.member_email
     WHERE m.organization_id = ? AND m.member_email = ? AND m.active = 1 AND s.active = 1
     LIMIT 1`
  ).bind(organizationId,email).first<{ok:number}>();
  return !!row?.ok;
}

async function bookingBelongsToOrg(db:D1Database, organizationId:number, bookingId:number|null) {
  if (!bookingId) return true;
  const row = await db.prepare("SELECT 1 AS ok FROM bookings WHERE organization_id = ? AND id = ? LIMIT 1")
    .bind(organizationId,bookingId).first<{ok:number}>();
  return !!row?.ok;
}

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const mine = url.searchParams.get("mine") === "1";
  const where = ["organization_id = ?"];
  const binds:(string|number)[] = [ctx.organizationId];
  if (status === "open" || status === "done") { where.push("status = ?"); binds.push(status); }
  if (mine) { where.push("assigned_email = ?"); binds.push(ctx.member.email); }

  const rows = await db.prepare(
    `SELECT id, title, details, status, priority,
            due_date AS dueDate, booking_id AS bookingId,
            assigned_email AS assignedEmail, created_by AS createdBy,
            completed_by AS completedBy, completed_at AS completedAt,
            created_at AS createdAt, updated_at AS updatedAt
     FROM staff_tasks
     WHERE ${where.join(" AND ")}
     ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,
              CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
              CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date, id DESC
     LIMIT 500`
  ).bind(...binds).all<TaskRow>();

  const members = await db.prepare(
    `SELECT s.email, s.display_name AS displayName, m.role
     FROM memberships m JOIN staff_members s ON s.email = m.member_email
     WHERE m.organization_id = ? AND m.active = 1 AND s.active = 1
     ORDER BY s.display_name, s.email`
  ).bind(ctx.organizationId).all<{email:string;displayName:string;role:string}>();

  return Response.json({ tasks:rows.results, members:members.results, staff:ctx.member });
}

export async function POST(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });

  const body = await request.json().catch(()=>({})) as {
    title?:string;details?:string;priority?:string;dueDate?:string;assignedEmail?:string;bookingId?:number|null;
  };
  const title = String(body.title || "").trim().slice(0,180);
  const details = String(body.details || "").trim().slice(0,4000);
  const priority = PRIORITIES.has(String(body.priority)) ? String(body.priority) : "normal";
  const dueDate = String(body.dueDate || "").trim();
  const assignedEmail = String(body.assignedEmail || "").trim().toLowerCase().slice(0,254);
  const bookingId = Number.isInteger(Number(body.bookingId)) && Number(body.bookingId) > 0 ? Number(body.bookingId) : null;

  if (!title) return Response.json({ error:"Вкажіть назву завдання" }, { status:400 });
  if (dueDate && !DATE_RE.test(dueDate)) return Response.json({ error:"Некоректна дата виконання" }, { status:400 });
  if (!(await activeMember(db,ctx.organizationId,assignedEmail))) return Response.json({ error:"Виконавець не належить до цієї організації" }, { status:400 });
  if (!(await bookingBelongsToOrg(db,ctx.organizationId,bookingId))) return Response.json({ error:"Дослідження не належить до цієї організації" }, { status:400 });

  const result = await db.prepare(
    `INSERT INTO staff_tasks
      (organization_id,title,details,status,priority,due_date,booking_id,assigned_email,created_by)
     VALUES (?,?,?,'open',?,?,?,?,?)`
  ).bind(ctx.organizationId,title,details,priority,dueDate,bookingId,assignedEmail,ctx.member.email).run();
  const id = Number(result.meta.last_row_id || 0);
  await audit(db,{ organizationId:ctx.organizationId, actorEmail:ctx.member.email, action:"task_created", resource:"task", targetId:id, details:{ priority, assigned:!!assignedEmail, linkedBooking:!!bookingId } });
  return Response.json({ ok:true,id }, { status:201 });
}

export async function PATCH(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });

  const body = await request.json().catch(()=>({})) as { id?:number;status?:string;assignedEmail?:string;priority?:string;dueDate?:string };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error:"Некоректне завдання" }, { status:400 });

  const existing = await db.prepare(
    `SELECT id, status, assigned_email AS assignedEmail, created_by AS createdBy
     FROM staff_tasks WHERE organization_id = ? AND id = ? LIMIT 1`
  ).bind(ctx.organizationId,id).first<{id:number;status:string;assignedEmail:string;createdBy:string}>();
  if (!existing) return Response.json({ error:"Завдання не знайдено" }, { status:404 });
  const canEdit = ctx.role === "admin" || existing.assignedEmail === ctx.member.email || existing.createdBy === ctx.member.email;
  if (!canEdit) return Response.json({ error:"Немає прав змінювати це завдання" }, { status:403 });

  const status = body.status === "done" ? "done" : body.status === "open" ? "open" : existing.status;
  const assignedEmail = body.assignedEmail === undefined ? existing.assignedEmail : String(body.assignedEmail || "").trim().toLowerCase().slice(0,254);
  const priority = body.priority === undefined ? null : PRIORITIES.has(String(body.priority)) ? String(body.priority) : null;
  const dueDate = body.dueDate === undefined ? null : String(body.dueDate || "").trim();
  if (body.priority !== undefined && !priority) return Response.json({ error:"Некоректний пріоритет" }, { status:400 });
  if (dueDate !== null && dueDate && !DATE_RE.test(dueDate)) return Response.json({ error:"Некоректна дата" }, { status:400 });
  if (!(await activeMember(db,ctx.organizationId,assignedEmail))) return Response.json({ error:"Виконавець не належить до цієї організації" }, { status:400 });

  await db.prepare(
    `UPDATE staff_tasks SET
       status = ?, assigned_email = ?,
       priority = COALESCE(?, priority), due_date = COALESCE(?, due_date),
       completed_by = CASE WHEN ? = 'done' THEN ? ELSE '' END,
       completed_at = CASE WHEN ? = 'done' THEN CURRENT_TIMESTAMP ELSE '' END,
       updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = ? AND id = ?`
  ).bind(status,assignedEmail,priority,dueDate,status,ctx.member.email,status,ctx.organizationId,id).run();

  await audit(db,{ organizationId:ctx.organizationId, actorEmail:ctx.member.email, action:status === "done" && existing.status !== "done" ? "task_completed" : "task_updated", resource:"task", targetId:id, details:{ status } });
  return Response.json({ ok:true });
}
