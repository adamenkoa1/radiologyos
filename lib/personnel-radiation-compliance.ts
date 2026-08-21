export type RadiationClearanceState =
  | "authorized"
  | "authorized_unknown_expiry"
  | "expired"
  | "suspended"
  | "revoked"
  | "review"
  | "missing";

export type RadiationTrainingState =
  | "current"
  | "unknown_expiry"
  | "expired"
  | "failed"
  | "review"
  | "missing";

export type DosimetryState =
  | "measured"
  | "below_detection"
  | "missing_result"
  | "review"
  | "missing";

export type RadiationMonitoringScopeState =
  | "in_scope"
  | "out_of_scope"
  | "review"
  | "unclassified";

export type RadiationReviewPolicy = {
  id:string;
  effectiveFrom:string;
  enabled:boolean;
  requireClearanceValidUntil:boolean;
  trainingMaxAgeDays:number | null;
  knowledgeCheckMaxAgeDays:number | null;
  dosimetryMaxAgeDays:number | null;
  sourceTitle:string;
  sourceReference:string;
};

export function classifyRadiationMonitoringScope(
  record: { scopeStatus?: string | null } | null,
): RadiationMonitoringScopeState {
  if (!record) return "unclassified";
  if (record.scopeStatus === "in_scope") return "in_scope";
  if (record.scopeStatus === "out_of_scope") return "out_of_scope";
  return "review";
}

export function radiationScopeReviewReasons(scope: RadiationMonitoringScopeState): string[] {
  if (scope === "unclassified") return ["Не визначено контур радіаційного контролю"];
  if (scope === "review") return ["Організаційний контур радіаційного контролю потребує уточнення"];
  return [];
}

export function classifyRadiationClearance(
  record: { decisionCode?: string | null; validUntil?: string | null } | null,
  asOf: string,
): RadiationClearanceState {
  if (!record) return "missing";
  if (record.decisionCode === "suspended") return "suspended";
  if (record.decisionCode === "revoked") return "revoked";
  if (record.decisionCode !== "authorized") return "review";
  if (record.validUntil && record.validUntil < asOf) return "expired";
  if (!record.validUntil) return "authorized_unknown_expiry";
  return "authorized";
}

export function classifyRadiationTraining(
  record: { resultCode?: string | null; validUntil?: string | null } | null,
  asOf: string,
): RadiationTrainingState {
  if (!record) return "missing";
  if (record.resultCode === "failed") return "failed";
  if (record.resultCode !== "completed" && record.resultCode !== "passed") return "review";
  if (record.validUntil && record.validUntil < asOf) return "expired";
  if (!record.validUntil) return "unknown_expiry";
  return "current";
}

export function classifyDosimetry(
  record: { measurementStatus?: string | null } | null,
): DosimetryState {
  if (!record) return "missing";
  if (record.measurementStatus === "measured") return "measured";
  if (record.measurementStatus === "below_detection") return "below_detection";
  if (record.measurementStatus === "missing") return "missing_result";
  return "review";
}

export function radiationReviewReasons(input: {
  clearance: RadiationClearanceState;
  training: RadiationTrainingState;
  knowledgeCheck: RadiationTrainingState;
  dosimetry: DosimetryState;
}): string[] {
  const reasons: string[] = [];

  if (input.clearance === "missing") reasons.push("Немає чинного запису допуску до ДІВ");
  if (input.clearance === "authorized_unknown_expiry") reasons.push("У допуску до ДІВ не вказано строк дії");
  if (input.clearance === "expired") reasons.push("Строк дії допуску до ДІВ закінчився");
  if (input.clearance === "suspended") reasons.push("Допуск до ДІВ призупинено");
  if (input.clearance === "revoked") reasons.push("Допуск до ДІВ відкликано");
  if (input.clearance === "review") reasons.push("Рішення щодо допуску до ДІВ потребує ручної перевірки");

  if (input.training === "missing") reasons.push("Немає запису навчання з радіаційної безпеки");
  if (input.training === "unknown_expiry") reasons.push("Для навчання з радіаційної безпеки не вказано строк дії");
  if (input.training === "expired") reasons.push("Строк дії навчання з радіаційної безпеки закінчився");
  if (input.training === "failed") reasons.push("Останній результат навчання з радіаційної безпеки негативний");
  if (input.training === "review") reasons.push("Навчання з радіаційної безпеки потребує ручної перевірки");

  if (input.knowledgeCheck === "expired") reasons.push("Строк дії останньої перевірки знань закінчився");
  if (input.knowledgeCheck === "failed") reasons.push("Остання перевірка знань не пройдена");
  if (input.knowledgeCheck === "review") reasons.push("Остання перевірка знань потребує ручної перевірки");

  if (input.dosimetry === "missing") reasons.push("Немає записів індивідуальної дозиметрії");
  if (input.dosimetry === "missing_result") reasons.push("Останній дозиметричний результат відсутній");
  if (input.dosimetry === "review") reasons.push("Останній дозиметричний запис потребує ручної перевірки");

  return reasons;
}

function ageDays(recordDate: string | null, asOf: string): number | null {
  if (!recordDate) return null;
  const start = Date.parse(`${recordDate}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000);
}

export function radiationPolicyReviewReasons(input: {
  policy: RadiationReviewPolicy | null;
  asOf:string;
  clearanceValidUntil:string | null;
  trainingDate:string | null;
  knowledgeDate:string | null;
  dosimetryPeriodEnd:string | null;
}): string[] {
  const policy = input.policy;
  if (!policy?.enabled) return [];

  const reasons: string[] = [];
  if (policy.requireClearanceValidUntil && !input.clearanceValidUntil) {
    reasons.push("У допуску до ДІВ не вказано строк дії");
  }

  if (policy.trainingMaxAgeDays != null && input.trainingDate) {
    const age = ageDays(input.trainingDate, input.asOf);
    if (age != null && age > policy.trainingMaxAgeDays) {
      reasons.push(`За політикою review: від навчання минуло ${age} дн. (критерій ${policy.trainingMaxAgeDays} дн.)`);
    }
  }

  if (policy.knowledgeCheckMaxAgeDays != null) {
    if (!input.knowledgeDate) {
      reasons.push("За політикою review: немає запису перевірки знань");
    } else {
      const age = ageDays(input.knowledgeDate, input.asOf);
      if (age != null && age > policy.knowledgeCheckMaxAgeDays) {
        reasons.push(`За політикою review: від перевірки знань минуло ${age} дн. (критерій ${policy.knowledgeCheckMaxAgeDays} дн.)`);
      }
    }
  }

  if (policy.dosimetryMaxAgeDays != null && input.dosimetryPeriodEnd) {
    const age = ageDays(input.dosimetryPeriodEnd, input.asOf);
    if (age != null && age > policy.dosimetryMaxAgeDays) {
      reasons.push(`За політикою review: від кінця останнього дозиметричного періоду минуло ${age} дн. (критерій ${policy.dosimetryMaxAgeDays} дн.)`);
    }
  }

  return reasons;
}

export function mergeRadiationReviewReasons(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}
