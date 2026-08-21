import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import type { AccessRole } from "../../../../../lib/staff-auth";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";

function canViewRadiationDoseSummary(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type DoseSummaryRow = {
  personnelId:string;
  displayName:string;
  positionTitle:string;
  departmentName:string | null;
  monitoringScopeStatus:string | null;
  monitoringScopeText:string | null;
  monitoringScopeEffectiveDate:string | null;
  firstPeriodStart:string | null;
  lastPeriodEnd:string | null;
  measuredCount:number;
  belowDetectionCount:number;
  missingCount:number;
  otherCount:number;
  hp10MeasuredSubtotal:number;
  hp007MeasuredSubtotal:number;
  hp3MeasuredSubtotal:number;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });

  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canViewRadiationDoseSummary(ctx.member.role)) {
    return Response.json({ error:"Доступ до дозового зведення персоналу заборонено" }, { status:403 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from")?.trim() || "";
  const to = url.searchParams.get("to")?.trim() || "";
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) {
    return Response.json({ error:"Перевірте період зведення" }, { status:400 });
  }

  const rows = await db.prepare(
    `WITH current_records AS (
       SELECT r.personnel_id, r.period_start, r.period_end, r.measurement_status,
              r.hp10_msv, r.hp007_msv, r.hp3_msv
       FROM personnel_dosimetry_records r
       WHERE r.organization_id = ?
         AND r.period_end >= ? AND r.period_end <= ?
         AND NOT EXISTS (
           SELECT 1 FROM personnel_dosimetry_records correction
           WHERE correction.supersedes_id = r.id
             AND correction.organization_id = r.organization_id
             AND correction.personnel_id = r.personnel_id
         )
     ),
     aggregated AS (
       SELECT personnel_id,
              MIN(period_start) AS first_period_start,
              MAX(period_end) AS last_period_end,
              SUM(CASE WHEN measurement_status = 'measured' THEN 1 ELSE 0 END) AS measured_count,
              SUM(CASE WHEN measurement_status = 'below_detection' THEN 1 ELSE 0 END) AS below_detection_count,
              SUM(CASE WHEN measurement_status = 'missing' THEN 1 ELSE 0 END) AS missing_count,
              SUM(CASE WHEN measurement_status = 'other' THEN 1 ELSE 0 END) AS other_count,
              SUM(CASE WHEN measurement_status = 'measured' THEN hp10_msv ELSE 0 END) AS hp10_measured_subtotal,
              SUM(CASE WHEN measurement_status = 'measured' THEN hp007_msv ELSE 0 END) AS hp007_measured_subtotal,
              SUM(CASE WHEN measurement_status = 'measured' THEN hp3_msv ELSE 0 END) AS hp3_measured_subtotal
       FROM current_records
       GROUP BY personnel_id
     ),
     monitoring_scope_ranked AS (
       SELECT r.personnel_id, r.scope_status, r.scope_text, r.effective_date,
              ROW_NUMBER() OVER (
                PARTITION BY r.personnel_id
                ORDER BY r.effective_date DESC, r.created_at DESC, r.id DESC
              ) AS rn
       FROM personnel_radiation_monitoring_scope_records r
       WHERE r.organization_id = ?
         AND r.effective_date <= ?
         AND NOT EXISTS (
           SELECT 1 FROM personnel_radiation_monitoring_scope_records correction
           WHERE correction.supersedes_id = r.id
             AND correction.organization_id = r.organization_id
             AND correction.personnel_id = r.personnel_id
             AND correction.effective_date <= ?
         )
     )
     SELECT p.id AS personnelId, p.display_name AS displayName,
            p.position_title AS positionTitle, d.name AS departmentName,
            ms.scope_status AS monitoringScopeStatus,
            ms.scope_text AS monitoringScopeText,
            ms.effective_date AS monitoringScopeEffectiveDate,
            a.first_period_start AS firstPeriodStart,
            a.last_period_end AS lastPeriodEnd,
            COALESCE(a.measured_count, 0) AS measuredCount,
            COALESCE(a.below_detection_count, 0) AS belowDetectionCount,
            COALESCE(a.missing_count, 0) AS missingCount,
            COALESCE(a.other_count, 0) AS otherCount,
            COALESCE(a.hp10_measured_subtotal, 0) AS hp10MeasuredSubtotal,
            COALESCE(a.hp007_measured_subtotal, 0) AS hp007MeasuredSubtotal,
            COALESCE(a.hp3_measured_subtotal, 0) AS hp3MeasuredSubtotal
     FROM personnel_records p
     LEFT JOIN departments d
       ON d.id = p.department_id AND d.organization_id = p.organization_id
     LEFT JOIN monitoring_scope_ranked ms ON ms.personnel_id = p.id AND ms.rn = 1
     LEFT JOIN aggregated a ON a.personnel_id = p.id
     WHERE p.organization_id = ? AND p.active = 1
     ORDER BY p.last_name, p.first_name, p.patronymic, p.id`,
  ).bind(
    ctx.organizationId, from, to,
    ctx.organizationId, to, to,
    ctx.organizationId,
  ).all<DoseSummaryRow>();

  const records = rows.results.map((row) => {
    const recordCount = row.measuredCount + row.belowDetectionCount + row.missingCount + row.otherCount;
    return {
      ...row,
      monitoringScopeState: row.monitoringScopeStatus || "unclassified",
      recordCount,
      hasNonMeasuredRecords: row.belowDetectionCount + row.missingCount + row.otherCount > 0,
      numericSubtotalAvailable: row.measuredCount > 0,
    };
  });

  const personnelWithRecords = records.filter((record) => record.recordCount > 0).length;
  const personnelWithNonMeasuredRecords = records.filter((record) => record.hasNonMeasuredRecords).length;
  const inScopeCount = records.filter((record) => record.monitoringScopeState === "in_scope").length;
  const outOfScopeCount = records.filter((record) => record.monitoringScopeState === "out_of_scope").length;
  const scopeReviewCount = records.length - inScopeCount - outOfScopeCount;

  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"personnel_radiation_dose_summary_viewed",
    resource:"personnel_radiation_dose_summary",
    details:{
      from,
      to,
      personnelCount:records.length,
      personnelWithRecords,
      personnelWithNonMeasuredRecords,
      inScopeCount,
      outOfScopeCount,
      scopeReviewCount,
    },
  });

  return Response.json({
    from,
    to,
    scopeAsOf:to,
    rangeBasis:"period_end",
    subtotalBasis:"measured_only",
    records,
    summary:{
      totalPersonnel:records.length,
      personnelWithRecords,
      personnelWithoutRecords:records.length - personnelWithRecords,
      personnelWithNonMeasuredRecords,
      inScopeCount,
      outOfScopeCount,
      scopeReviewCount,
    },
  }, { headers:{ "cache-control":"no-store" } });
}
