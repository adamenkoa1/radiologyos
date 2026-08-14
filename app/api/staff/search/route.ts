// Global staff search for the command palette. Every data source is tenant-scoped;
// clinical sources additionally honor the caller's authoritative membership role.

import { requireOrgContext } from "../../../../lib/tenant";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { stateLabel } from "../../../../lib/study-state";
import { canManageImaging, canManageProtocols, type StaffRole } from "../../../../lib/staff-auth";
import { dbBinding } from "../../../../lib/db";
import { getSetting } from "../../../../lib/settings";
import { EQUIPMENT_REGISTRY_KEY, parseEquipmentRegistry } from "../../../../lib/equipment-registry";

function nameVariants(q: string): string[] {
  const lower = q.toLowerCase();
  const title = q.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return [...new Set([q, lower, title])];
}

function bookingAssignment(alias:string, role:StaffRole, email:string) {
  if (role === "radiologist") return { sql:` AND ${alias}.assigned_radiologist_email = ?`, binds:[email] };
  if (role === "radiographer") return { sql:` AND ${alias}.assigned_radiographer_email = ?`, binds:[email] };
  return { sql:"", binds:[] as string[] };
}

function registryKey(organizationId:number) {
  return organizationId === 1 ? EQUIPMENT_REGISTRY_KEY : `org:${organizationId}:${EQUIPMENT_REGISTRY_KEY}`;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ results: [] }, { headers: { "cache-control": "no-store" } });

  const role = ctx.role as StaffRole;
  const variants = nameVariants(q);
  const assignment = bookingAssignment("b", role, ctx.member.email);
  const bookingConds:string[] = [];
  const bookingBinds:(string|number)[] = [ctx.organizationId, ...assignment.binds];
  for (const v of variants) { bookingConds.push("b.name LIKE ?"); bookingBinds.push(`%${v}%`); }
  bookingConds.push("UPPER(b.code) LIKE ?"); bookingBinds.push(`%${q.toUpperCase()}%`);
  const phoneDigits = q.replace(/\D/g, "");
  if (phoneDigits.length >= 3) {
    bookingConds.push("b.phone_normalized LIKE ?");
    bookingBinds.push(`%${normalizeUkrainianPhone(q) || phoneDigits}%`);
  }

  const bookings = await db.prepare(
    `SELECT b.id, b.code, b.name, b.phone, b.service, b.desired_date AS desiredDate,
            b.desired_time AS desiredTime, b.status
       FROM bookings b
      WHERE b.organization_id = ?${assignment.sql} AND (${bookingConds.join(" OR ")})
      ORDER BY b.created_at DESC, b.id DESC LIMIT 10`
  ).bind(...bookingBinds).all<{
    id:number;code:string;name:string;phone:string;service:string;desiredDate:string;desiredTime:string;status:string;
  }>();

  const results:Array<Record<string,unknown>> = (bookings.results || []).map((r) => ({
    type:"booking", key:`booking:${r.id}`, id:r.id, bookingId:r.id, code:r.code, name:r.name,
    phone:r.phone, service:r.service, desiredDate:r.desiredDate, desiredTime:r.desiredTime,
    statusLabel:stateLabel(String(r.status)),
    title:`${r.name || "Без імені"} · ${r.code}`,
    subtitle:`${r.service} · ${r.desiredDate}${r.desiredTime ? ` ${r.desiredTime}` : ""} · ${stateLabel(String(r.status))}`,
    href:`/staff?open=${r.id}`,
  }));

  if (canManageImaging(role)) {
    const imagingAssignment = bookingAssignment("b", role, ctx.member.email);
    const imaging = await db.prepare(
      `SELECT b.id AS bookingId, b.code, b.name, s.accession_number AS accessionNumber,
              s.modality, s.study_datetime AS studyDatetime, s.study_status AS studyStatus
         FROM imaging_studies s JOIN bookings b ON b.id = s.booking_id
        WHERE b.organization_id = ?${imagingAssignment.sql}
          AND (UPPER(s.accession_number) LIKE ? OR UPPER(b.code) LIKE ? OR UPPER(s.modality) LIKE ?)
        ORDER BY s.updated_at DESC LIMIT 6`
    ).bind(ctx.organizationId,...imagingAssignment.binds,`%${q.toUpperCase()}%`,`%${q.toUpperCase()}%`,`%${q.toUpperCase()}%`).all<{
      bookingId:number;code:string;name:string;accessionNumber:string;modality:string;studyDatetime:string;studyStatus:string;
    }>();
    for (const r of imaging.results || []) results.push({
      type:"imaging", key:`imaging:${r.bookingId}`, bookingId:r.bookingId,
      title:`${r.accessionNumber || r.code} · ${r.modality || "DICOM"}`,
      subtitle:`${r.name || "Пацієнт"} · ${r.studyDatetime || "дата не вказана"}`,
      href:`/staff/imaging?booking=${r.bookingId}`,
    });
  }

  if (canManageProtocols(role)) {
    const protocolAssignment = bookingAssignment("b", role, ctx.member.email);
    const textConds:string[] = ["UPPER(p.number) LIKE ?"];
    const textBinds:(string|number)[] = [`%${q.toUpperCase()}%`];
    for (const v of variants) {
      textConds.push("p.findings LIKE ?","p.conclusion LIKE ?","b.name LIKE ?");
      textBinds.push(`%${v}%`,`%${v}%`,`%${v}%`);
    }
    const protocols = await db.prepare(
      `SELECT b.id AS bookingId, b.code, b.name, b.service, p.number, p.status
         FROM protocols p JOIN bookings b ON b.id = p.booking_id
        WHERE b.organization_id = ?${protocolAssignment.sql} AND (${textConds.join(" OR ")})
        ORDER BY p.updated_at DESC LIMIT 6`
    ).bind(ctx.organizationId,...protocolAssignment.binds,...textBinds).all<{
      bookingId:number;code:string;name:string;service:string;number:string;status:string;
    }>();
    for (const r of protocols.results || []) results.push({
      type:"protocol", key:`protocol:${r.bookingId}`, bookingId:r.bookingId,
      title:`Протокол ${r.number || r.code}`,
      subtitle:`${r.name || "Пацієнт"} · ${r.service} · ${r.status}`,
      href:`/staff/protocols?booking=${r.bookingId}`,
    });
  }

  const equipment = parseEquipmentRegistry(await getSetting(db,registryKey(ctx.organizationId)));
  const qLower = q.toLowerCase();
  for (const item of equipment.filter((e)=>`${e.type} ${e.manufacturer} ${e.model} ${e.room} ${e.serialNumber}`.toLowerCase().includes(qLower)).slice(0,6)) {
    results.push({
      type:"equipment", key:`equipment:${item.id}`,
      title:[item.manufacturer,item.model].filter(Boolean).join(" ") || item.type,
      subtitle:`${item.type} · ${item.room}${item.serialNumber ? ` · № ${item.serialNumber}` : ""}`,
      href:"/staff/equipment",
    });
  }

  const maintenance = await db.prepare(
    `SELECT id, equipment_id AS equipmentId, event_type AS eventType, status, title, vendor, due_date AS dueDate
       FROM equipment_maintenance_events
      WHERE organization_id = ? AND (title LIKE ? OR details LIKE ? OR vendor LIKE ?)
      ORDER BY updated_at DESC LIMIT 6`
  ).bind(ctx.organizationId,`%${q}%`,`%${q}%`,`%${q}%`).all<{
    id:number;equipmentId:string;eventType:string;status:string;title:string;vendor:string;dueDate:string;
  }>();
  for (const r of maintenance.results || []) results.push({
    type:"maintenance", key:`maintenance:${r.id}`,
    title:r.title,
    subtitle:`ТО/сервіс · ${r.eventType} · ${r.status}${r.dueDate ? ` · до ${r.dueDate}` : ""}`,
    href:"/staff/maintenance",
  });

  return Response.json({ results:results.slice(0,30) }, { headers: { "cache-control": "no-store" } });
}
