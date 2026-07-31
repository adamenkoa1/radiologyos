import { EQUIPMENT, SERVICES, serviceByCode } from "../../../../lib/catalog";
import { canViewReports } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { logSecurityEvent } from "../../../../lib/audit";
import { REPORT_TEMPLATES } from "../../../../lib/reporting";
import { dbBinding } from "../../../../lib/db";
import {
  fetchReportSource,
  publicFilters,
  readReportFilters,
  reportPayload,
} from "../../../../lib/reporting-server";


export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" },{ status:503 });
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" },{ status:403 });
  const member = ctx.member;
  if (!canViewReports(member.role)) {
    return Response.json({ error:"Звіти з медичними та фінансовими даними доступні лише адміністратору" },{ status:403 });
  }

  const filters = readReportFilters(new URL(request.url));
  if (!filters) return Response.json({ error:"Некоректний період або параметри звіту" },{ status:400 });
  const source = await fetchReportSource(db,filters,ctx.organizationId);
  const activeRows = source.filter((row)=>row.status !== "cancelled");
  const completedRows = source.filter((row)=>row.status === "completed");
  const protocolReady = (status:string) => status === "ready" || status === "issued";

  const summary = {
    total:source.length,
    active:activeRows.length,
    completed:completedRows.length,
    cancelled:source.filter((row)=>row.status === "cancelled").length,
    military:activeRows.filter((row)=>row.patientCategory === "military").length,
    civilian:activeRows.filter((row)=>row.patientCategory !== "military").length,
    protocolsReady:source.filter((row)=>protocolReady(row.protocolStatus)).length,
    awaitingProtocol:completedRows.filter((row)=>!protocolReady(row.protocolStatus)).length,
    pendingPayments:activeRows.filter(
      (row)=>row.patientCategory !== "military" && !["paid","not_required"].includes(row.paymentStatus)
    ).length,
    paidRevenue:source.filter((row)=>row.paymentStatus === "paid").reduce((sum,row)=>sum + Number(row.paidAmount || 0),0),
    expectedRevenue:activeRows.filter((row)=>row.patientCategory !== "military").reduce(
      (sum,row)=>sum + Number(row.paymentAmount || serviceByCode(row.serviceCode)?.price || 0),0
    ),
    nszuPending:activeRows.filter((row)=>row.referralType === "eh_referral" && row.nszuStatus === "pending").length,
    performed:source.filter((row)=>!!row.performedAt).length,
    regions:source.filter((row)=>!!row.performedAt).reduce((sum,row)=>sum + Number(row.anatomicalRegionsCount || 1),0),
  };

  const equipment = new Map<string,number>();
  const services = new Map<string,{code:string;title:string;count:number;revenue:number}>();
  const days = new Map<string,{
    date:string;total:number;completed:number;cancelled:number;military:number;civilian:number;revenue:number;
  }>();
  const sources = new Map<string,number>();
  for (const row of source) {
    const day = days.get(row.reportDate) || {
      date:row.reportDate,total:0,completed:0,cancelled:0,military:0,civilian:0,revenue:0,
    };
    day.total += 1;
    if (row.status === "completed") day.completed += 1;
    if (row.status === "cancelled") day.cancelled += 1;
    if (row.status !== "cancelled" && row.patientCategory === "military") day.military += 1;
    if (row.status !== "cancelled" && row.patientCategory !== "military") day.civilian += 1;
    if (row.paymentStatus === "paid") day.revenue += Number(row.paidAmount || 0);
    days.set(row.reportDate,day);
    if (row.status === "cancelled") continue;
    equipment.set(row.equipmentId,(equipment.get(row.equipmentId) || 0) + 1);
    const service = services.get(row.serviceCode) || {
      code:row.serviceCode,title:serviceByCode(row.serviceCode)?.title || row.service,count:0,revenue:0,
    };
    service.count += 1;
    if (row.paymentStatus === "paid") service.revenue += Number(row.paidAmount || 0);
    services.set(row.serviceCode,service);
    const sourceName = row.marketingSource || "Не вказано";
    sources.set(sourceName,(sources.get(sourceName) || 0) + 1);
  }

  const [{ results:staffOptions },{ results:exportHistory }] = await Promise.all([
    db.prepare(
      "SELECT email, display_name AS displayName, role FROM staff_members WHERE active = 1 ORDER BY role, display_name"
    ).all(),
    db.prepare(
      `SELECT e.id, e.requested_by AS requestedBy,
        COALESCE(NULLIF(s.display_name,''), e.requested_by) AS requestedByName,
        e.report_type AS reportType, e.row_count AS rowCount,
        e.format, e.contains_personal_data AS containsPersonalData,
        e.created_at AS createdAt
       FROM report_exports e
       LEFT JOIN staff_members s ON s.email = e.requested_by
       ORDER BY e.created_at DESC LIMIT 20`
    ).all(),
  ]);
  const report = reportPayload(filters,source);
  await logSecurityEvent(db, {
    actorEmail: member.email,
    action: "report_viewed",
    resource: "report",
    targetId: filters.template,
    details: { from: filters.from, to: filters.to, rows: report.rows.length },
  });
  return Response.json({
    ...publicFilters(filters),
    summary,
    byEquipment:[...equipment.entries()].map(([id,count])=>({
      id,name:EQUIPMENT[id as keyof typeof EQUIPMENT]?.name || id,count,
    })).sort((a,b)=>b.count-a.count),
    byService:[...services.values()].sort((a,b)=>b.count-a.count).slice(0,12),
    byDay:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    bySource:[...sources.entries()].map(([sourceName,count])=>({source:sourceName,count})).sort((a,b)=>b.count-a.count),
    templates:Object.values(REPORT_TEMPLATES),
    activeTemplate:report.template,
    columns:report.columns,
    preview:report.rows.slice(0,100),
    previewTotal:report.rows.length,
    exportHistory,
    filterOptions:{
      staff:staffOptions,
      equipment:Object.values(EQUIPMENT),
      services:SERVICES.map((service)=>({code:service.code,title:service.title})),
    },
    staff:member,
  },{ headers:{"cache-control":"no-store"} });
}
