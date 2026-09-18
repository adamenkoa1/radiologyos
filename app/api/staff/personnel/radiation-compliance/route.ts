import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import {
  classifyDosimetry,
  classifyRadiationClearance,
  classifyRadiationMonitoringScope,
  classifyRadiationTraining,
  mergeRadiationReviewReasons,
  radiationPolicyReviewReasons,
  radiationReviewReasons,
  radiationScopeReviewReasons,
  type RadiationReviewPolicy,
} from "../../../../../lib/personnel-radiation-compliance";
import type { AccessRole } from "../../../../../lib/staff-auth";
import { requireSelfServiceOrgContext } from "../../../../../lib/tenant";

function canViewRadiationCompliance(role: AccessRole) {
  return role === "admin" || role === "department_head";
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type RawPolicyRow = {
  id:string;
  effectiveFrom:string;
  enabled:number;
  requireClearanceValidUntil:number;
  trainingMaxAgeDays:number | null;
  knowledgeCheckMaxAgeDays:number | null;
  dosimetryMaxAgeDays:number | null;
  sourceTitle:string;
  sourceReference:string;
};

type RawComplianceRow = {
  personnelId: string;
  displayName: string;
  positionTitle: string;
  departmentName: string | null;
  monitoringScopeStatus: string | null;
  monitoringScopeEffectiveDate: string | null;
  monitoringScopeText: string | null;
  monitoringScopeBasisTitle: string | null;
  clearanceDecisionCode: string | null;
  clearanceEffectiveDate: string | null;
  clearanceValidUntil: string | null;
  clearanceDocumentNumber: string | null;
  trainingResultCode: string | null;
  trainingDate: string | null;
  trainingValidUntil: string | null;
  trainingCourseTitle: string | null;
  knowledgeResultCode: string | null;
  knowledgeDate: string | null;
  knowledgeValidUntil: string | null;
  knowledgeCourseTitle: string | null;
  dosimetryMeasurementStatus: string | null;
  dosimetryPeriodStart: string | null;
  dosimetryPeriodEnd: string | null;
  dosimetryReportNumber: string | null;
};

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });

  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx || !canViewRadiationCompliance(ctx.member.role)) {
    return Response.json({ error: "Доступ до зведення радіаційної безпеки заборонено" }, { status: 403 });
  }

  const requestedAsOf = new URL(request.url).searchParams.get("asOf")?.trim() || "";
  const asOf = requestedAsOf || new Date().toISOString().slice(0, 10);
  if (!isIsoDate(asOf)) {
    return Response.json({ error: "Дата зрізу має бути у форматі РРРР-ММ-ДД" }, { status: 400 });
  }

  // Effective-dated policy selection deliberately does NOT filter superseded rows.
  // A future revision may supersede today's leaf but must not take effect before
  // its own effective_from. For the requested date we pick the latest revision
  // that had already become effective, using created_at/id to resolve same-date corrections.
  const rawPolicy = await db.prepare(
    `SELECT r.id, r.effective_from AS effectiveFrom, r.enabled,
       r.require_clearance_valid_until AS requireClearanceValidUntil,
       r.training_max_age_days AS trainingMaxAgeDays,
       r.knowledge_check_max_age_days AS knowledgeCheckMaxAgeDays,
       r.dosimetry_max_age_days AS dosimetryMaxAgeDays,
       r.source_title AS sourceTitle, r.source_reference AS sourceReference
     FROM personnel_radiation_review_policy_revisions r
     WHERE r.organization_id = ? AND r.effective_from <= ?
     ORDER BY r.effective_from DESC, r.created_at DESC, r.id DESC
     LIMIT 1`,
  ).bind(ctx.organizationId, asOf).first<RawPolicyRow>();

  const policy: RadiationReviewPolicy | null = rawPolicy ? {
    id:rawPolicy.id,
    effectiveFrom:rawPolicy.effectiveFrom,
    enabled:Boolean(rawPolicy.enabled),
    requireClearanceValidUntil:Boolean(rawPolicy.requireClearanceValidUntil),
    trainingMaxAgeDays:rawPolicy.trainingMaxAgeDays,
    knowledgeCheckMaxAgeDays:rawPolicy.knowledgeCheckMaxAgeDays,
    dosimetryMaxAgeDays:rawPolicy.dosimetryMaxAgeDays,
    sourceTitle:rawPolicy.sourceTitle,
    sourceReference:rawPolicy.sourceReference,
  } : null;

  const rows = await db.prepare(
    `WITH monitoring_scope_ranked AS (
       SELECT r.personnel_id, r.scope_status, r.effective_date,
              r.scope_text, r.basis_title,
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
     ),
     clearance_ranked AS (
       SELECT r.personnel_id, r.decision_code, r.effective_date, r.valid_until,
              r.document_number,
              ROW_NUMBER() OVER (
                PARTITION BY r.personnel_id
                ORDER BY r.effective_date DESC, r.created_at DESC, r.id DESC
              ) AS rn
       FROM personnel_radiation_clearance_records r
       WHERE r.organization_id = ?
         AND r.effective_date <= ?
         AND NOT EXISTS (
           SELECT 1 FROM personnel_radiation_clearance_records correction
           WHERE correction.supersedes_id = r.id
             AND correction.organization_id = r.organization_id
             AND correction.personnel_id = r.personnel_id
         )
     ),
     training_ranked AS (
       SELECT r.personnel_id, r.result_code, r.training_date, r.valid_until,
              r.course_title,
              ROW_NUMBER() OVER (
                PARTITION BY r.personnel_id
                ORDER BY r.training_date DESC, r.created_at DESC, r.id DESC
              ) AS rn
       FROM personnel_radiation_training_records r
       WHERE r.organization_id = ?
         AND r.training_kind = 'radiation_safety'
         AND r.training_date <= ?
         AND NOT EXISTS (
           SELECT 1 FROM personnel_radiation_training_records correction
           WHERE correction.supersedes_id = r.id
             AND correction.organization_id = r.organization_id
             AND correction.personnel_id = r.personnel_id
         )
     ),
     knowledge_ranked AS (
       SELECT r.personnel_id, r.result_code, r.training_date, r.valid_until,
              r.course_title,
              ROW_NUMBER() OVER (
                PARTITION BY r.personnel_id
                ORDER BY r.training_date DESC, r.created_at DESC, r.id DESC
              ) AS rn
       FROM personnel_radiation_training_records r
       WHERE r.organization_id = ?
         AND r.training_kind = 'knowledge_check'
         AND r.training_date <= ?
         AND NOT EXISTS (
           SELECT 1 FROM personnel_radiation_training_records correction
           WHERE correction.supersedes_id = r.id
             AND correction.organization_id = r.organization_id
             AND correction.personnel_id = r.personnel_id
         )
     ),
     dosimetry_ranked AS (
       SELECT r.personnel_id, r.measurement_status, r.period_start, r.period_end,
              r.report_number,
              ROW_NUMBER() OVER (
                PARTITION BY r.personnel_id
                ORDER BY r.period_end DESC, r.period_start DESC, r.created_at DESC, r.id DESC
              ) AS rn
       FROM personnel_dosimetry_records r
       WHERE r.organization_id = ?
         AND r.period_end <= ?
         AND NOT EXISTS (
           SELECT 1 FROM personnel_dosimetry_records correction
           WHERE correction.supersedes_id = r.id
             AND correction.organization_id = r.organization_id
             AND correction.personnel_id = r.personnel_id
         )
     )
     SELECT p.id AS personnelId, p.display_name AS displayName,
            p.position_title AS positionTitle, d.name AS departmentName,
            ms.scope_status AS monitoringScopeStatus,
            ms.effective_date AS monitoringScopeEffectiveDate,
            ms.scope_text AS monitoringScopeText,
            ms.basis_title AS monitoringScopeBasisTitle,
            c.decision_code AS clearanceDecisionCode,
            c.effective_date AS clearanceEffectiveDate,
            c.valid_until AS clearanceValidUntil,
            c.document_number AS clearanceDocumentNumber,
            t.result_code AS trainingResultCode,
            t.training_date AS trainingDate,
            t.valid_until AS trainingValidUntil,
            t.course_title AS trainingCourseTitle,
            k.result_code AS knowledgeResultCode,
            k.training_date AS knowledgeDate,
            k.valid_until AS knowledgeValidUntil,
            k.course_title AS knowledgeCourseTitle,
            dm.measurement_status AS dosimetryMeasurementStatus,
            dm.period_start AS dosimetryPeriodStart,
            dm.period_end AS dosimetryPeriodEnd,
            dm.report_number AS dosimetryReportNumber
     FROM personnel_records p
     LEFT JOIN departments d
       ON d.id = p.department_id AND d.organization_id = p.organization_id
     LEFT JOIN monitoring_scope_ranked ms ON ms.personnel_id = p.id AND ms.rn = 1
     LEFT JOIN clearance_ranked c ON c.personnel_id = p.id AND c.rn = 1
     LEFT JOIN training_ranked t ON t.personnel_id = p.id AND t.rn = 1
     LEFT JOIN knowledge_ranked k ON k.personnel_id = p.id AND k.rn = 1
     LEFT JOIN dosimetry_ranked dm ON dm.personnel_id = p.id AND dm.rn = 1
     WHERE p.organization_id = ? AND p.active = 1
     ORDER BY p.last_name, p.first_name, p.patronymic, p.id`,
  ).bind(
    ctx.organizationId, asOf, asOf,
    ctx.organizationId, asOf,
    ctx.organizationId, asOf,
    ctx.organizationId, asOf,
    ctx.organizationId, asOf,
    ctx.organizationId,
  ).all<RawComplianceRow>();

  const records = rows.results.map((row) => {
    const monitoringScopeState = classifyRadiationMonitoringScope(
      row.monitoringScopeStatus ? { scopeStatus:row.monitoringScopeStatus } : null,
    );
    const clearanceRecord = row.clearanceDecisionCode ? {
      decisionCode: row.clearanceDecisionCode,
      validUntil: row.clearanceValidUntil,
    } : null;
    const trainingRecord = row.trainingResultCode ? {
      resultCode: row.trainingResultCode,
      validUntil: row.trainingValidUntil,
    } : null;
    const knowledgeRecord = row.knowledgeResultCode ? {
      resultCode: row.knowledgeResultCode,
      validUntil: row.knowledgeValidUntil,
    } : null;
    const dosimetryRecord = row.dosimetryMeasurementStatus ? {
      measurementStatus: row.dosimetryMeasurementStatus,
    } : null;

    const clearanceState = classifyRadiationClearance(clearanceRecord, asOf);
    const trainingState = classifyRadiationTraining(trainingRecord, asOf);
    const knowledgeCheckState = classifyRadiationTraining(knowledgeRecord, asOf);
    const dosimetryState = classifyDosimetry(dosimetryRecord);
    const scopeReviewReasons = radiationScopeReviewReasons(monitoringScopeState);

    const baseReviewReasons = monitoringScopeState === "in_scope" ? radiationReviewReasons({
      clearance: clearanceState,
      training: trainingState,
      knowledgeCheck: knowledgeCheckState,
      dosimetry: dosimetryState,
    }) : [];
    const policyReviewReasons = monitoringScopeState === "in_scope" ? radiationPolicyReviewReasons({
      policy,
      asOf,
      clearanceValidUntil:row.clearanceValidUntil,
      trainingDate:row.trainingDate,
      knowledgeDate:row.knowledgeDate,
      dosimetryPeriodEnd:row.dosimetryPeriodEnd,
    }) : [];
    const reviewReasons = mergeRadiationReviewReasons(
      scopeReviewReasons,
      baseReviewReasons,
      policyReviewReasons,
    );
    const summaryState = monitoringScopeState === "out_of_scope"
      ? "out_of_scope"
      : reviewReasons.length ? "review" : "recorded";

    return {
      ...row,
      monitoringScopeState,
      clearanceState,
      trainingState,
      knowledgeCheckState,
      dosimetryState,
      scopeReviewReasons,
      baseReviewReasons,
      policyReviewReasons,
      reviewReasons,
      summaryState,
    };
  });

  const inScopeCount = records.filter((record) => record.monitoringScopeState === "in_scope").length;
  const outOfScopeCount = records.filter((record) => record.monitoringScopeState === "out_of_scope").length;
  const scopeReviewCount = records.filter(
    (record) => record.monitoringScopeState === "review" || record.monitoringScopeState === "unclassified",
  ).length;
  const reviewCount = records.filter((record) => record.summaryState === "review").length;
  const recordedCount = records.filter((record) => record.summaryState === "recorded").length;
  const policyReviewCount = records.filter((record) => record.policyReviewReasons.length > 0).length;

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_radiation_compliance_viewed",
    resource: "personnel_radiation_compliance",
    details: {
      asOf,
      recordCount: records.length,
      inScopeCount,
      outOfScopeCount,
      scopeReviewCount,
      reviewCount,
      policyId: policy?.id || "",
      policyReviewCount,
    },
  });

  return Response.json(
    {
      asOf,
      policy,
      records,
      summary: {
        total: records.length,
        inScopeCount,
        outOfScopeCount,
        scopeReviewCount,
        reviewCount,
        recordedCount,
        policyReviewCount,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
