import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import {
  classifyDosimetry,
  classifyRadiationClearance,
  classifyRadiationTraining,
  radiationReviewReasons,
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

type RawComplianceRow = {
  personnelId: string;
  displayName: string;
  positionTitle: string;
  departmentName: string | null;
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

  const rows = await db.prepare(
    `WITH clearance_ranked AS (
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
     LEFT JOIN clearance_ranked c ON c.personnel_id = p.id AND c.rn = 1
     LEFT JOIN training_ranked t ON t.personnel_id = p.id AND t.rn = 1
     LEFT JOIN knowledge_ranked k ON k.personnel_id = p.id AND k.rn = 1
     LEFT JOIN dosimetry_ranked dm ON dm.personnel_id = p.id AND dm.rn = 1
     WHERE p.organization_id = ? AND p.active = 1
     ORDER BY p.last_name, p.first_name, p.patronymic, p.id`,
  ).bind(
    ctx.organizationId, asOf,
    ctx.organizationId, asOf,
    ctx.organizationId, asOf,
    ctx.organizationId, asOf,
    ctx.organizationId,
  ).all<RawComplianceRow>();

  const records = rows.results.map((row) => {
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
    const reviewReasons = radiationReviewReasons({
      clearance: clearanceState,
      training: trainingState,
      knowledgeCheck: knowledgeCheckState,
      dosimetry: dosimetryState,
    });

    return {
      ...row,
      clearanceState,
      trainingState,
      knowledgeCheckState,
      dosimetryState,
      reviewReasons,
      summaryState: reviewReasons.length ? "review" : "recorded",
    };
  });

  const reviewCount = records.filter((record) => record.summaryState === "review").length;
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "personnel_radiation_compliance_viewed",
    resource: "personnel_radiation_compliance",
    details: { asOf, recordCount: records.length, reviewCount },
  });

  return Response.json(
    { asOf, records, summary: { total: records.length, reviewCount, recordedCount: records.length - reviewCount } },
    { headers: { "cache-control": "no-store" } },
  );
}
