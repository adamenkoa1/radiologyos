// Чистий валідатор/завантажувач клінічної бібліотеки протоколів
// (MASTER PROMPT 4, Этап 0 — Library Audit).
//
// Призначення: НЕЗАЛЕЖНО (не довіряючи маніфесту) перевірити проміжну JSON-
// бібліотеку клінічних шаблонів/знахідок перед будь-якою інтеграцією в
// конструктор. Модуль суто детермінований: без мережі, без egress, без запису,
// без імпорту `./protocols` чи БД — тож він runtime-importable під сирим
// node-ранером і не торкається lifecycle/підписання/прав.
//
// Межі (MP4, обов'язкові): нічого не імпортується в продакшн; синтетичні
// приклади пацієнтів НЕ є записами; незгоджені модальності позначаються
// needs_review; дані пацієнтів у вхідних файлах не очікуються і додатково
// скануються.

// Погоджені модальності проєкту (AGENTS.md §46): КТ, рентгенографія,
// флюорографія, пантомографія, УЗД. У кодуванні бібліотеки: CT = КТ,
// XR = рентгенографія/флюорографія. МРТ (MRI) НЕ погоджено → needs_review.
export const AGREED_MODALITY_CODES = ["CT", "XR"] as const;
export type ModalityCode = string;

// Класи стану запису після аудиту.
export type ImportReadiness = "import_ready" | "needs_review" | "rejected";

export type LibraryParameter = {
  key: string;
  required?: boolean;
  type?: "string" | "number" | string;
  unit?: string | null;
};

export type NormalTemplate = {
  id: string;
  title_uk: string;
  modality: ModalityCode;
  region: string;
  template_type?: string;
  method?: string;
  description_uk: string;
  conclusion_uk: string;
  requires_clinician_review?: boolean;
  review_status?: string;
  conditional_sections?: unknown[];
  version?: string;
};

export type PathologyFinding = {
  id: string;
  name_uk: string;
  region: string;
  modality: ModalityCode;
  parameters: LibraryParameter[];
  description_template_uk: string;
  conclusion_template_uk: string;
  certainty?: string;
  review_status?: string;
  source_class?: string;
};

export type ClinicalRule = {
  id: string;
  label_uk: string;
  severity?: string;
  behavior?: string;
  auto_rewrite?: boolean;
  implementation_status?: string;
};

export type TemplateExample = {
  id: string;
  modality?: string;
  region?: string;
  finding_id?: string;
  parameters?: Record<string, unknown>;
  [k: string]: unknown;
};

export type LibraryManifest = {
  schema_version?: string;
  status?: string;
  language?: string;
  patient_data_included?: boolean;
  normal_template_ids?: string[];
  finding_ids?: string[];
  regions?: string[];
  modalities?: string[];
  [k: string]: unknown;
};

export type LibraryInput = {
  manifest: LibraryManifest;
  templates: NormalTemplate[];
  findings: PathologyFinding[];
  rules: ClinicalRule[];
  examples: TemplateExample[];
};

export type IssueSeverity = "error" | "warn" | "info";

export type AuditIssue = {
  severity: IssueSeverity;
  code: string;
  recordId?: string;
  message: string;
};

export type RecordVerdict = {
  id: string;
  kind: "normal_template" | "finding";
  modality: ModalityCode;
  region: string;
  readiness: ImportReadiness;
  reasons: string[];
};

export type AuditReport = {
  // Прямі підрахунки (не з маніфесту).
  counts: {
    normalTemplates: number;
    findings: number;
    rules: number;
    syntheticExamplesExcluded: number;
  };
  // Звірка з маніфестом (інформаційно; підрахунок — завжди прямий).
  manifestMatches: boolean;
  // Жодних даних пацієнтів у текстових полях (незалежний скан).
  patientDataDetected: boolean;
  // Усі ID унікальні в межах свого набору і між наборами (шаблони+знахідки).
  idsUnique: boolean;
  // Статуси придатності по кожному запису.
  verdicts: RecordVerdict[];
  // Зведення придатності.
  readinessCounts: Record<ImportReadiness, number>;
  // Усі зауваги аудиту.
  issues: AuditIssue[];
  // Готово до безпечного dry-run імпорту (PR2+) лише якщо немає error-issue
  // і не виявлено даних пацієнтів. Це НЕ дозвіл на продакшн-імпорт.
  safeForDryRun: boolean;
};

const PLACEHOLDER_RE = /\{([a-z0-9_]+)\}/g;

// Витягти імена плейсхолдерів із шаблонного тексту.
export function extractPlaceholders(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) out.push(m[1]);
  return out;
}

// Незалежний скан на дані пацієнта. Шаблони НЕ мають містити ПІБ/контактів;
// це додатковий запобіжник поверх запевнення маніфесту (patient_data_included).
const PII_PATTERNS: { code: string; re: RegExp }[] = [
  { code: "email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { code: "phone", re: /\+?\d[\d ()-]{8,}\d/ },
  { code: "long_id", re: /\b\d{6,}\b/ },
  // «Пацієнт/хворий Прізвище І.Б.» — явна згадка конкретної особи.
  { code: "named_patient", re: /(?:пацієнт(?:ка)?|хвор(?:ий|а))\s+[А-ЯІЇЄҐ][а-яіїєґ'’]+\s+[А-ЯІЇЄҐ]\.?\s?[А-ЯІЇЄҐ]\./ },
  // Дата народження.
  { code: "dob", re: /\b\d{2}\.\d{2}\.\d{4}\b/ },
];

export function scanForPatientData(text: string): string[] {
  const hits: string[] = [];
  for (const { code, re } of PII_PATTERNS) if (re.test(text)) hits.push(code);
  return hits;
}

function templateText(t: NormalTemplate): string {
  return [t.title_uk, t.method || "", t.description_uk, t.conclusion_uk].join("\n");
}
function findingText(f: PathologyFinding): string {
  return [f.name_uk, f.description_template_uk, f.conclusion_template_uk].join("\n");
}

// Головний аудит: прямі підрахунки + перевірки цілісності + класифікація.
export function auditLibrary(input: LibraryInput): AuditReport {
  const { manifest, templates, findings, rules, examples } = input;
  const issues: AuditIssue[] = [];

  // --- Прямі підрахунки (не довіряємо маніфесту) ---
  const counts = {
    normalTemplates: templates.length,
    findings: findings.length,
    rules: rules.length,
    syntheticExamplesExcluded: examples.length,
  };

  // --- Звірка з маніфестом (інформаційно) ---
  const manifestTplN = manifest.normal_template_ids?.length ?? -1;
  const manifestFindN = manifest.finding_ids?.length ?? -1;
  const manifestMatches = manifestTplN === counts.normalTemplates && manifestFindN === counts.findings;
  if (!manifestMatches) {
    issues.push({
      severity: "warn",
      code: "manifest_count_mismatch",
      message: `Маніфест заявляє ${manifestTplN} шаблонів / ${manifestFindN} знахідок, фактично ${counts.normalTemplates} / ${counts.findings}.`,
    });
  }

  // --- Унікальність ID (у межах набору і між наборами) ---
  const tplIds = templates.map((t) => t.id);
  const findIds = findings.map((f) => f.id);
  const dupWithin = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  const dupTpl = [...new Set(dupWithin(tplIds))];
  const dupFind = [...new Set(dupWithin(findIds))];
  const crossDup = tplIds.filter((id) => findIds.includes(id));
  for (const id of dupTpl) issues.push({ severity: "error", code: "duplicate_template_id", recordId: id, message: `Дубльований ID шаблону: ${id}.` });
  for (const id of dupFind) issues.push({ severity: "error", code: "duplicate_finding_id", recordId: id, message: `Дубльований ID знахідки: ${id}.` });
  for (const id of crossDup) issues.push({ severity: "error", code: "id_collision", recordId: id, message: `ID збігається між шаблоном і знахідкою: ${id}.` });
  const idsUnique = dupTpl.length === 0 && dupFind.length === 0 && crossDup.length === 0;

  // --- Скан даних пацієнта (усі текстові поля) ---
  let patientDataDetected = false;
  for (const t of templates) {
    const hits = scanForPatientData(templateText(t));
    if (hits.length) {
      patientDataDetected = true;
      issues.push({ severity: "error", code: "patient_data_detected", recordId: t.id, message: `Можливі дані пацієнта (${hits.join(", ")}) у шаблоні ${t.id}.` });
    }
  }
  for (const f of findings) {
    const hits = scanForPatientData(findingText(f));
    if (hits.length) {
      patientDataDetected = true;
      issues.push({ severity: "error", code: "patient_data_detected", recordId: f.id, message: `Можливі дані пацієнта (${hits.join(", ")}) у знахідці ${f.id}.` });
    }
  }
  if (manifest.patient_data_included === true) {
    patientDataDetected = true;
    issues.push({ severity: "error", code: "manifest_claims_patient_data", message: "Маніфест заявляє patient_data_included=true." });
  }

  // --- Класифікація кожного запису ---
  const verdicts: RecordVerdict[] = [];
  const classify = (
    id: string,
    kind: RecordVerdict["kind"],
    modality: ModalityCode,
    region: string,
    localErrors: string[],
  ): RecordVerdict => {
    const reasons: string[] = [...localErrors];
    let readiness: ImportReadiness = "needs_review";
    if (localErrors.length) {
      readiness = "rejected";
    } else if (!AGREED_MODALITY_CODES.includes(modality as (typeof AGREED_MODALITY_CODES)[number])) {
      reasons.push(`Незгоджена модальність ${modality} (поза AGENTS.md).`);
      readiness = "needs_review";
    } else {
      // Усі записи бібліотеки — draft_unvalidated: клінічна перевірка обов'язкова
      // перед публікацією, тож стеля придатності PR1 — needs_review, НЕ ready.
      reasons.push("draft_unvalidated — потрібна клінічна перевірка лікарем.");
      readiness = "needs_review";
    }
    return { id, kind, modality, region, readiness, reasons };
  };

  for (const t of templates) {
    const localErrors: string[] = [];
    if (!t.id || !t.title_uk || !t.description_uk || !t.conclusion_uk) localErrors.push("Відсутнє обов'язкове поле.");
    if (t.review_status && t.review_status !== "draft_unvalidated") {
      issues.push({ severity: "info", code: "unexpected_review_status", recordId: t.id, message: `Несподіваний review_status=${t.review_status} у ${t.id}.` });
    }
    verdicts.push(classify(t.id, "normal_template", t.modality, t.region, localErrors));
  }

  for (const f of findings) {
    const localErrors: string[] = [];
    if (!f.id || !f.name_uk || !f.description_template_uk || !f.conclusion_template_uk) localErrors.push("Відсутнє обов'язкове поле.");
    // Цілісність плейсхолдерів: кожен {x} має відповідати оголошеному параметру.
    const keys = new Set((f.parameters || []).map((p) => p.key));
    const used = new Set([...extractPlaceholders(f.description_template_uk), ...extractPlaceholders(f.conclusion_template_uk)]);
    const undefinedPh = [...used].filter((k) => !keys.has(k));
    if (undefinedPh.length) localErrors.push(`Невизначені плейсхолдери: ${undefinedPh.join(", ")}.`);
    // Числові параметри повинні мати одиницю виміру.
    for (const p of f.parameters || []) {
      if (p.type === "number" && !p.unit) {
        issues.push({ severity: "warn", code: "number_without_unit", recordId: f.id, message: `Числовий параметр ${p.key} без одиниці у ${f.id}.` });
      }
    }
    verdicts.push(classify(f.id, "finding", f.modality, f.region, localErrors));
  }

  // --- Зведення придатності ---
  const readinessCounts: Record<ImportReadiness, number> = { import_ready: 0, needs_review: 0, rejected: 0 };
  for (const v of verdicts) readinessCounts[v.readiness] += 1;

  const hasError = issues.some((i) => i.severity === "error");
  const safeForDryRun = !hasError && !patientDataDetected;

  return {
    counts,
    manifestMatches,
    patientDataDetected,
    idsUnique,
    verdicts,
    readinessCounts,
    issues,
    safeForDryRun,
  };
}
