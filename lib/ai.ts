import { protocolTemplateByKey, renderProtocolText, type ProtocolDocument } from "./protocols";

// AI drafting assistant for radiology protocols.
//
// The engine is intentionally split into two parts:
//   1. a deterministic, offline generator (`heuristicDraft`) that needs no
//      external service, no API key and no network — it derives a draft
//      conclusion from how the structured fields deviate from the template's
//      "normal" phrasing;
//   2. a stable `ProtocolDraft` contract and a `buildDraftPrompt` helper so a
//      real LLM (Cloudflare Workers AI `env.AI`, or an external provider) can
//      be plugged in behind `generateProtocolDraft` without touching callers.
//
// The output is always a DRAFT: it is never a diagnosis and must be reviewed
// and edited by the radiologist before the protocol is issued.

export type ProtocolDeviation = {
  section:string;
  field:string;
  label:string;
  value:string;
  normal:string;
};

export type ProtocolDraft = {
  engine:string;
  conclusion:string;
  recommendations:string;
  deviations:ProtocolDeviation[];
  reviewedFieldCount:number;
  disclaimer:string;
};

export type DraftContext = {
  priorStudies?:number;
  patientAge?:number;
};

export const AI_DISCLAIMER =
  "AI-чернетка. Не є медичним висновком чи діагнозом. Лікар-рентгенолог зобов’язаний перевірити та відредагувати текст перед видачею протоколу.";

// Sections that describe technique/conditions rather than clinical findings —
// a non-default value here (e.g. contrast used) is not a pathology.
const TECHNIQUE_SECTIONS = new Set(["parameters"]);

function normalize(value:string) {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.;]+$/, "").trim();
}

function joinSentences(parts:string[]) {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

// Collect fields whose value departs from the template's normal phrasing.
export function collectDeviations(document:ProtocolDocument):ProtocolDeviation[] {
  const template = protocolTemplateByKey(document.templateKey);
  const deviations:ProtocolDeviation[] = [];
  for (const section of template.sections) {
    if (TECHNIQUE_SECTIONS.has(section.key)) continue;
    const values = document.sections[section.key] || {};
    for (const field of section.fields) {
      if (!field.normal) continue;
      const value = (values[field.key] || "").trim();
      if (!value) continue;
      if (normalize(value) !== normalize(field.normal)) {
        deviations.push({ section:section.key, field:field.key, label:field.label, value, normal:field.normal });
      }
    }
  }
  return deviations;
}

function reviewedFieldCount(document:ProtocolDocument):number {
  const template = protocolTemplateByKey(document.templateKey);
  let count = 0;
  for (const section of template.sections) {
    if (TECHNIQUE_SECTIONS.has(section.key)) continue;
    const values = document.sections[section.key] || {};
    for (const field of section.fields) if (field.normal && (values[field.key] || "").trim()) count += 1;
  }
  return count;
}

function usesContrast(document:ProtocolDocument):boolean {
  for (const values of Object.values(document.sections)) {
    for (const value of Object.values(values)) if (/контраст/i.test(value) && !/без контраст/i.test(value)) return true;
  }
  return /контраст/i.test(document.method) && !/без контраст/i.test(document.method);
}

// Deterministic, dependency-free draft. Same input always yields the same text.
export function heuristicDraft(document:ProtocolDocument, context:DraftContext = {}):ProtocolDraft {
  const template = protocolTemplateByKey(document.templateKey);
  const deviations = collectDeviations(document);
  const reviewed = reviewedFieldCount(document);

  let conclusion:string;
  if (deviations.length === 0) {
    conclusion = reviewed
      ? `За даними ${template.modalityLabel.toLowerCase()} патологічних змін у межах дослідження «${template.title}» не виявлено.`
      : `Заповніть структуровані поля протоколу, щоб сформувати чернетку висновку для дослідження «${template.title}».`;
  } else {
    const listed = deviations
      .map((deviation) => `${deviation.label.toLowerCase()} — ${deviation.value.replace(/[.;]+$/, "")}`)
      .join("; ");
    conclusion = joinSentences([
      `Виявлено відхилення від норми: ${listed}.`,
      "Рекомендоване клініко-лабораторне співставлення.",
    ]);
  }
  if (document.findings.trim()) conclusion = joinSentences([conclusion, "Враховано додатковий опис лікаря."]);

  const recommendationLines:string[] = [];
  recommendationLines.push(deviations.length
    ? "Консультація профільного спеціаліста та динамічний контроль за клінічними показаннями."
    : "Планове спостереження відповідно до клінічної картини.");
  if ((context.priorStudies || 0) > 0) {
    recommendationLines.push(`Зіставити з попередніми дослідженнями пацієнта (${context.priorStudies}).`);
  }
  if (usesContrast(document)) {
    recommendationLines.push("Контроль функції нирок після внутрішньовенного контрастування.");
  }

  return {
    engine:"heuristic",
    conclusion,
    recommendations:recommendationLines.join("\n"),
    deviations,
    reviewedFieldCount:reviewed,
    disclaimer:AI_DISCLAIMER,
  };
}

// Prompt a future LLM would receive. Kept here so wiring a provider is a
// one-function change inside `generateProtocolDraft`.
export function buildDraftPrompt(document:ProtocolDocument, context:DraftContext = {}):string {
  const lines = [
    "Ти асистент лікаря-рентгенолога. На основі структурованого протоколу нижче",
    "склади стислий проєкт висновку та рекомендацій українською мовою.",
    "Не став остаточних діагнозів — це чернетка для перевірки лікарем.",
    "",
    renderProtocolText(document),
  ];
  if ((context.priorStudies || 0) > 0) lines.push("", `Попередніх виконаних досліджень пацієнта: ${context.priorStudies}.`);
  return lines.join("\n");
}

// Single entry point. Today it returns the deterministic draft; swap the body
// for an LLM call (using buildDraftPrompt) when a provider is configured.
export function generateProtocolDraft(document:ProtocolDocument, context:DraftContext = {}):ProtocolDraft {
  return heuristicDraft(document, context);
}
