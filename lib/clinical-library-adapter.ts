import type { NormalTemplate, PathologyFinding, LibraryParameter } from "./clinical-library";
import type { MeasurementKind, RegionDef } from "./findings-composer";

// Локальні копії двох leaf-значень із clinical-library. Дублюємо навмисно: цей
// модуль має лишатися runtime-importable сирим node-ранером (behavior-тести), а
// value-import extensionless-сусіда не резолвиться під ним. Значення тривіальні
// й мають guard-тест на синхронність із clinical-library.
const AGREED_MODALITY_CODES = ["CT", "XR"] as const;
const PLACEHOLDER_RE = /\{([a-z0-9_]+)\}/g;
function extractPlaceholders(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) out.push(m[1]);
  return out;
}

// Адаптер проміжної клінічної бібліотеки → модель RadiologyOS
// (MASTER PROMPT 4, Этап 2 + Этап 3 — dry-run план імпорту).
//
// Призначення: ЧИСТО (без мережі/egress/БД/запису) відобразити записи бібліотеки
// у внутрішні моделі конструктора (знахідки `findings-composer`, базові шаблони
// `protocols`) і побудувати ДЕТЕРМІНОВАНИЙ dry-run план імпорту:
// create / skip / needs_review / reject — з ідемпотентністю та детекцією
// дублікатів. Нічого не створюється й не публікується: план лише показує, що
// адаптер ЗРОБИВ БИ, усі нові записи — у статусі огляду (requiresReview), ніколи
// не опубліковані. Наявні каталоги/БД/lifecycle/підпис не зачіпаються.
//
// Межі (MP4): без нових таблиць; системні й персональні шаблони зберігаються
// (не перезаписуються — дублікати → skip); незгоджені модальності та відсутні
// у конструкторі ділянки → needs_review (ручне рішення, не авто-створення);
// production-імпорт — окремий дозвіл.

// ── Відображення ділянок бібліотеки → ключі каталогу знахідок (лише КТ) ───────
// Ключ каталогу `findings-composer` існує лише для цих ділянок. Для відсутніх
// (bones_joints, head_neck, vascular) відображення немає → needs_review.
export const FINDING_REGION_TO_CATALOG: Record<string, string | undefined> = {
  brain: "ct_brain",
  chest: "ct_chest",
  abdomen: "ct_abdomen",
  spine: "ct_spine",
  sinuses: "ct_sinuses",
};

// ── Відображення модальність+ділянка → очікуваний базовий ключ шаблону ────────
// Звіряється з НАЯВНИМИ ключами protocols.ts (передаються ззовні — чистота).
const MODALITY_PREFIX: Record<string, string | undefined> = {
  CT: "ct",
  XR: "xray",
  FLUORO: "fluoro",
  MRI: "mri",
};
const TEMPLATE_REGION_SLUG: Record<string, string | undefined> = {
  brain: "brain",
  chest: "chest",
  abdomen: "abdomen",
  spine: "spine",
  bones_joints: "bone",
  sinuses: "sinuses",
  // head_neck і vascular навмисно відсутні — немає представлення в конструкторі.
};

export function expectedTemplateKey(modality: string, region: string): string | undefined {
  const prefix = MODALITY_PREFIX[modality];
  const slug = TEMPLATE_REGION_SLUG[region];
  if (!prefix || !slug) return undefined;
  return `${prefix}_${slug}`;
}

// ── Відображення параметрів → одиниці вимірів конструктора ────────────────────
// Числовий параметр бібліотеки → MeasurementKind, якщо він відповідає відомій
// метриці конструктора. Інакше лишається «вільним» параметром (не метрикою).
export function measurementKindFor(param: LibraryParameter): MeasurementKind | undefined {
  const key = param.key.toLowerCase();
  const unit = (param.unit || "").toLowerCase();
  if (unit === "hu" || key.endsWith("_hu")) return "hu";
  if (unit === "mm" && /size|розмір/.test(key)) return "sizeMm";
  if (unit === "mm" && /displacement|shift|зміщ/.test(key)) return "shiftMm";
  return undefined;
}

export function importKeyFor(sourceId: string): string {
  return `clinlib:${sourceId}`;
}

// ── Адаптовані моделі (проміжні; побудова build()-функцій — у PR3 під оглядом) ─
export type AdaptedFinding = {
  importKey: string;
  sourceId: string;
  kind: "finding";
  catalogRegionKey: string | null;
  label: string;
  descriptionTemplate: string;
  conclusionTemplate: string;
  parameters: LibraryParameter[];
  measurements: MeasurementKind[];
  needsContrast: boolean;
  certainty?: string;
  requiresReview: true;
};

export type AdaptedTemplate = {
  importKey: string;
  sourceId: string;
  kind: "normal_template";
  expectedKey: string | null;
  modality: string;
  region: string;
  title: string;
  method: string;
  description: string;
  conclusion: string;
  requiresReview: true;
};

const CONTRAST_RE = /контраст|ангіо|оклюз|стеноз|тромб/i;

export function adaptFinding(f: PathologyFinding): AdaptedFinding {
  const params = f.parameters || [];
  const measurements: MeasurementKind[] = [];
  for (const p of params) {
    const kind = measurementKindFor(p);
    if (kind && !measurements.includes(kind)) measurements.push(kind);
  }
  return {
    importKey: importKeyFor(f.id),
    sourceId: f.id,
    kind: "finding",
    catalogRegionKey: FINDING_REGION_TO_CATALOG[f.region] ?? null,
    label: f.name_uk,
    descriptionTemplate: f.description_template_uk,
    conclusionTemplate: f.conclusion_template_uk,
    parameters: params,
    measurements,
    needsContrast: CONTRAST_RE.test(`${f.name_uk} ${f.description_template_uk} ${f.conclusion_template_uk}`),
    certainty: f.certainty,
    requiresReview: true,
  };
}

export function adaptNormalTemplate(t: NormalTemplate): AdaptedTemplate {
  return {
    importKey: importKeyFor(t.id),
    sourceId: t.id,
    kind: "normal_template",
    expectedKey: expectedTemplateKey(t.modality, t.region) ?? null,
    modality: t.modality,
    region: t.region,
    title: t.title_uk,
    method: t.method || "",
    description: t.description_uk,
    conclusion: t.conclusion_uk,
    requiresReview: true,
  };
}

// ── План імпорту (dry-run) ────────────────────────────────────────────────────
export type PlanAction = "create" | "skip" | "needs_review" | "reject";

export type PlannedItem = {
  importKey: string;
  sourceId: string;
  kind: "finding" | "normal_template";
  action: PlanAction;
  reason: string;
  // Для create: завжди true і published:false — нічого не публікується dry-run'ом.
  requiresReview: boolean;
  published: false;
  possibleDuplicateOf?: string;
};

export type ImportPlan = {
  items: PlannedItem[];
  counts: Record<PlanAction, number>;
  // true лише якщо жодного reject і жодного hard-error. НЕ дозвіл на продакшн.
  safeForDryRun: boolean;
};

export type PlanContext = {
  // Наявний каталог знахідок (передається з findings-composer для чистоти).
  existingCatalog: RegionDef[];
  // Наявні ключі базових шаблонів protocols.ts.
  existingTemplateKeys: string[];
  // Ключі вже імпортованих записів (ідемпотентність повторного запуску).
  alreadyImported?: Set<string>;
};

// Нормалізація назви для детекції дублікатів: нижній регістр, лише літери/цифри.
function normName(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-zа-яіїєґ'’]+/gi, "");
}

export function planImport(
  library: { templates: NormalTemplate[]; findings: PathologyFinding[] },
  ctx: PlanContext,
): ImportPlan {
  const already = ctx.alreadyImported ?? new Set<string>();
  const existingTemplateKeys = new Set(ctx.existingTemplateKeys);
  const items: PlannedItem[] = [];

  // Індекс наявних знахідок по ділянці (нормалізовані назви + перше значуще слово).
  const existingByRegion = new Map<string, { names: Set<string>; labels: string[] }>();
  for (const r of ctx.existingCatalog) {
    const names = new Set<string>();
    const labels: string[] = [];
    for (const t of r.targets) for (const fd of t.findings) { names.add(normName(fd.label)); labels.push(fd.label); }
    existingByRegion.set(r.key, { names, labels });
  }

  // ── Знахідки ──
  for (const f of library.findings) {
    const key = importKeyFor(f.id);
    const base = { importKey: key, sourceId: f.id, kind: "finding" as const, requiresReview: true, published: false as const };
    if (already.has(key)) {
      items.push({ ...base, action: "skip", reason: "вже імпортовано (ідемпотентність)." });
      continue;
    }
    // Hard-reject: невизначені плейсхолдери (цілісність шаблону).
    const paramKeys = new Set((f.parameters || []).map((p) => p.key));
    const undefinedPh = [...new Set([...extractPlaceholders(f.description_template_uk), ...extractPlaceholders(f.conclusion_template_uk)])].filter((k) => !paramKeys.has(k));
    if (undefinedPh.length) {
      items.push({ ...base, action: "reject", reason: `невизначені плейсхолдери: ${undefinedPh.join(", ")}.` });
      continue;
    }
    const regionKey = FINDING_REGION_TO_CATALOG[f.region];
    if (!regionKey) {
      items.push({ ...base, action: "needs_review", reason: `ділянка «${f.region}» не представлена в наявному конструкторі — рішення про додавання ручне.` });
      continue;
    }
    const existing = existingByRegion.get(regionKey);
    const nn = normName(f.name_uk);
    if (existing && existing.names.has(nn)) {
      items.push({ ...base, action: "skip", reason: `знахідка вже є в каталозі ${regionKey}: «${f.name_uk}».` });
      continue;
    }
    // Нова знахідка в наявній ділянці → створюється у статусі огляду (НЕ публікується).
    const dup = existing?.labels.find((lbl) => {
      const a = normName(lbl), b = nn;
      return a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a));
    });
    items.push({ ...base, action: "create", reason: `нова знахідка для ${regionKey}; draft_unvalidated — створюється у статусі огляду, не публікується.`, ...(dup ? { possibleDuplicateOf: dup } : {}) });
  }

  // ── Нормальні/базові шаблони ──
  for (const t of library.templates) {
    const key = importKeyFor(t.id);
    const base = { importKey: key, sourceId: t.id, kind: "normal_template" as const, requiresReview: true, published: false as const };
    if (already.has(key)) {
      items.push({ ...base, action: "skip", reason: "вже імпортовано (ідемпотентність)." });
      continue;
    }
    if (!AGREED_MODALITY_CODES.includes(t.modality as (typeof AGREED_MODALITY_CODES)[number])) {
      items.push({ ...base, action: "needs_review", reason: `незгоджена модальність ${t.modality} (поза AGENTS.md) — рішення ручне.` });
      continue;
    }
    const expected = expectedTemplateKey(t.modality, t.region);
    if (!expected) {
      items.push({ ...base, action: "needs_review", reason: `ділянка «${t.region}» не має представлення серед базових шаблонів — рішення ручне.` });
      continue;
    }
    if (existingTemplateKeys.has(expected)) {
      items.push({ ...base, action: "skip", reason: `базовий шаблон ${expected} вже існує — не перезаписуємо.` });
      continue;
    }
    items.push({ ...base, action: "create", reason: `новий базовий шаблон (${expected}); draft_unvalidated — у статусі огляду, не публікується.` });
  }

  const counts: Record<PlanAction, number> = { create: 0, skip: 0, needs_review: 0, reject: 0 };
  for (const it of items) counts[it.action] += 1;
  const safeForDryRun = counts.reject === 0;

  return { items, counts, safeForDryRun };
}
