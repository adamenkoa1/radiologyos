import { logSecurityEvent } from "../../../../../lib/audit";
import { canViewReports } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import {
  fetchReportSource,
  publicFilters,
  readReportFilters,
  reportPayload,
} from "../../../../../lib/reporting-server";
import { createXlsx } from "../../../../../lib/xlsx";
import { dbBinding } from "../../../../../lib/db";

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" },{ status:503 });
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" },{ status:403 });
  const member = ctx.member;
  if (!canViewReports(member.role)) {
    return Response.json({ error:"Експорт звітів доступний лише адміністратору" },{ status:403 });
  }

  const filters = readReportFilters(new URL(request.url));
  if (!filters) return Response.json({ error:"Некоректні параметри звіту" },{ status:400 });
  const source = await fetchReportSource(db,filters,ctx.organizationId);
  const { template,columns,rows } = reportPayload(filters,source);
  const workbook = createXlsx(template.label,columns,rows);
  const containsPersonalData = ["studies","protocols","finance"].includes(filters.template) ? 1 : 0;

  await db.prepare(
    `INSERT INTO report_exports (
      organization_id, requested_by, report_type, filters_json, columns_json, format,
      row_count, contains_personal_data
    ) VALUES (?, ?, ?, ?, ?, 'xlsx', ?, ?)`
  ).bind(
    ctx.organizationId,
    member.email,
    filters.template,
    JSON.stringify(publicFilters(filters)),
    JSON.stringify(columns.map((item)=>item.key)),
    rows.length,
    containsPersonalData
  ).run();
  await logSecurityEvent(db, {
    actorEmail: member.email,
    action: "report_exported",
    resource: "report",
    targetId: filters.template,
    details: { format: "xlsx", rows: rows.length, containsPersonalData: Boolean(containsPersonalData) },
  });

  const filename = `radiologyos-${filters.template}-${filters.from}-${filters.to}.xlsx`;
  const body = new ArrayBuffer(workbook.byteLength);
  new Uint8Array(body).set(workbook);
  return new Response(body,{
    headers:{
      "content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":`attachment; filename="${filename}"`,
      "cache-control":"no-store",
    },
  });
}
