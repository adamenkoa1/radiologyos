import type { ProtocolDocument } from "./protocols";

// Конструктор структурованих знахідок (Этап C MASTER-завдання /staff/protocols).
//
// Що це і чого НЕ робить:
// - Чистий, детермінований, без залежностей модуль, який із структурованого
//   вибору лікаря (ділянка → орган → знахідка → латералізація → сегменти →
//   виміри → модифікатори) складає граматично коректне українське речення
//   опису та узгоджене речення висновку.
// - Він НЕ зберігає даних, НЕ торкається lifecycle/підпису/API: складений текст
//   ДОДАЄТЬСЯ (append) у вже наявні вільні поля `findings`/`conclusion`
//   документа протоколу через `insertComposedFinding`, ніколи не перезаписуючи
//   ручні правки лікаря (вимога §6 завдання).
// - Каталог знань — свідомо курований seed для трьох MVP-ділянок
//   (КТ ОГК, КТ головного мозку, КТ органів черевної порожнини). Його
//   розширення на інші модальності — наступний етап (Этап D), а не прихована
//   неповнота: UI показує лише те, що тут реально змодельовано.
//
// Клінічні застереження формуються лише зі структурованих даних — модуль не
// вигадує знахідок, розмірів чи динаміки (узгоджено з AGENTS.md: «AI не приймає
// клінічне рішення замість лікаря»; тут це взагалі не AI, а шаблонна композиція).

export type Laterality = "none" | "right" | "left" | "bilateral";

export const LATERALITY_LABEL: Record<Laterality, string> = {
  none: "Без латералізації",
  right: "Справа",
  left: "Зліва",
  bilateral: "Двобічно",
};

// Виміри, які може нести знахідка. Одиниці фіксовані тут, тож текст завжди
// виходить з коректною одиницею (вимога §10 «розміри мають правильні одиниці»).
export type MeasurementKind = "hu" | "sizeMm" | "volumeMl" | "shiftMm";

export const MEASUREMENT_META: Record<MeasurementKind, { label: string; unit: string; prefix: string }> = {
  hu: { label: "Щільність", unit: "HU", prefix: "щільністю" },
  sizeMm: { label: "Розмір", unit: "мм", prefix: "розміром" },
  volumeMl: { label: "Об’єм", unit: "мл", prefix: "об’ємом" },
  shiftMm: { label: "Зміщення", unit: "мм", prefix: "на" },
};

export type MeasurementInput = Partial<Record<MeasurementKind, number>>;

export type FindingModifier = {
  id: string;
  label: string;
  // Фраза в орудному/прийменниковому відмінку, що вплітається в опис
  // («збідненням легеневого судинного малюнка», «без сформованих бул»).
  phrase: string;
  // Взаємовиключні модифікатори (напр. «без бул» ↔ «зі сформованими булами»).
  conflictsWith?: string[];
};

export type SegmentPreset = {
  id: string;
  label: string;
  locative: string; // «базальних сегментах S7–S10»
  genitive: string; // «базальних сегментів S7–S10»
};

export type LobeOption = {
  id: string;
  label: string;
  locative: string; // «нижній частці»
  genitive: string; // «нижньої частки»
};

type Site = { locative: string; genitive: string };

export type FindingSelection = {
  regionKey: string;
  targetId: string;
  findingId: string;
  laterality?: Laterality;
  lobeId?: string;
  segmentId?: string;
  measurements?: MeasurementInput;
  modifierIds?: string[];
};

export type ComposedFinding = {
  regionKey: string;
  targetId: string;
  findingId: string;
  laterality: Laterality;
  description: string;
  conclusion: string;
};

type BuildContext = {
  site: Site;
  measurements: MeasurementInput;
  modifiers: FindingModifier[];
  conclusionPrefix: string;
};

export type FindingDef = {
  id: string;
  label: string;
  // Чи має сенс латералізація для цієї знахідки (успадковує від target, але
  // знахідка може її вимкнути, напр. «серединні структури»).
  laterality?: boolean;
  measurements?: MeasurementKind[];
  modifiers?: FindingModifier[];
  // Чи потребує знахідка контрастування для коректної характеристики
  // (використовується клінічною перевіркою §10).
  needsContrast?: boolean;
  build: (ctx: BuildContext) => { description: string; conclusion: string };
};

export type TargetDef = {
  id: string;
  label: string;
  laterality: boolean;
  lobes?: LobeOption[];
  segmentPresets?: SegmentPreset[];
  // Форми для нелатералізованого органа (печінка, селезінка, вільна рідина).
  fixedSite?: Site;
  // Форми для латералізованого органа (нирка, півкуля мозку, легеня без частки).
  lateralSite?: Partial<Record<Exclude<Laterality, "none">, Site>>;
  // База для складеної легеневої ділянки (частка/сегмент + сторона).
  lateralBase?: Partial<Record<Exclude<Laterality, "none">, string>>; // genitive: «правої легені»
  findings: FindingDef[];
};

export type RegionDef = {
  key: string; // збігається з ключем шаблону протоколу (ct_chest тощо)
  label: string;
  conclusionPrefix: string; // «КТ-ознаки»
  targets: TargetDef[];
};

// ── Форматування чисел ───────────────────────────────────────────────────────
const MINUS = "−"; // справжній знак мінуса для денситометрії (−952 HU)
function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? MINUS : "";
  const abs = Math.abs(value);
  const rounded = Math.round(abs * 10) / 10;
  return `${sign}${Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",")}`;
}

function measurementClause(kind: MeasurementKind, value: number): string {
  const meta = MEASUREMENT_META[kind];
  return `${meta.prefix} ${fmtNumber(value)} ${meta.unit}`;
}

// ── Каталог знань (seed для трьох MVP-ділянок) ───────────────────────────────

const LUNG_LOBES: LobeOption[] = [
  { id: "upper", label: "Верхня частка", locative: "верхній частці", genitive: "верхньої частки" },
  { id: "middle", label: "Середня частка (праворуч)", locative: "середній частці", genitive: "середньої частки" },
  { id: "lower", label: "Нижня частка", locative: "нижній частці", genitive: "нижньої частки" },
];

const LUNG_SEGMENTS: SegmentPreset[] = [
  { id: "apical", label: "Верхівкові сегменти (S1–S2)", locative: "верхівкових сегментах S1–S2", genitive: "верхівкових сегментів S1–S2" },
  { id: "basal", label: "Базальні сегменти (S7–S10)", locative: "базальних сегментах S7–S10", genitive: "базальних сегментів S7–S10" },
  { id: "lingula", label: "Язичкові сегменти (S4–S5)", locative: "язичкових сегментах S4–S5", genitive: "язичкових сегментів S4–S5" },
];

function noBullae(): FindingModifier {
  return { id: "no_bullae", label: "Без сформованих бул", phrase: "без сформованих бул", conflictsWith: ["with_bullae"] };
}
function withBullae(): FindingModifier {
  return { id: "with_bullae", label: "Зі сформованими булами", phrase: "зі сформованими булами", conflictsWith: ["no_bullae"] };
}
function poorVascularity(): FindingModifier {
  return { id: "poor_vascular", label: "Збіднення судинного малюнка", phrase: "збідненням легеневого судинного малюнка" };
}

export const FINDINGS_CATALOG: RegionDef[] = [
  {
    key: "ct_chest",
    label: "КТ органів грудної клітки",
    conclusionPrefix: "КТ-ознаки",
    targets: [
      {
        id: "lung",
        label: "Легеня",
        laterality: true,
        lobes: LUNG_LOBES,
        segmentPresets: LUNG_SEGMENTS,
        lateralBase: { right: "правої легені", left: "лівої легені", bilateral: "обох легень" },
        lateralSite: {
          right: { locative: "правій легені", genitive: "правої легені" },
          left: { locative: "лівій легені", genitive: "лівої легені" },
          bilateral: { locative: "обох легенях", genitive: "обох легень" },
        },
        findings: [
          {
            id: "hyperpneumatization",
            label: "Локальна гіперпневматизація (емфізема)",
            laterality: true,
            measurements: ["hu"],
            modifiers: [poorVascularity(), noBullae(), withBullae()],
            build: ({ site, measurements, modifiers, conclusionPrefix }) => {
              let description = `У ${site.locative} визначається локальна ділянка вираженої гіперпневматизації легеневої паренхіми`;
              if (typeof measurements.hu === "number") {
                description += ` зі зниженням денситометричної щільності до ${fmtNumber(measurements.hu)} HU`;
              }
              for (const modifier of modifiers) description += `, ${modifier.phrase}`;
              description += ".";
              const conclusion = `${conclusionPrefix} локальної вираженої гіперпневматизації ${site.genitive}.`;
              return { description, conclusion };
            },
          },
          {
            id: "infiltration",
            label: "Вогнищево-інфільтративні зміни",
            laterality: true,
            measurements: ["sizeMm"],
            build: ({ site, measurements, conclusionPrefix }) => {
              let description = `У ${site.locative} визначається ділянка інфільтрації легеневої паренхіми`;
              if (typeof measurements.sizeMm === "number") description += ` ${measurementClause("sizeMm", measurements.sizeMm)}`;
              description += ".";
              const conclusion = `${conclusionPrefix} вогнищево-інфільтративних змін ${site.genitive}.`;
              return { description, conclusion };
            },
          },
          {
            id: "nodule",
            label: "Солідний вузлик",
            laterality: true,
            measurements: ["sizeMm", "hu"],
            build: ({ site, measurements, conclusionPrefix }) => {
              let description = `У ${site.locative} визначається солідний вузлик з чіткими контурами`;
              const parts: string[] = [];
              if (typeof measurements.sizeMm === "number") parts.push(measurementClause("sizeMm", measurements.sizeMm));
              if (typeof measurements.hu === "number") parts.push(measurementClause("hu", measurements.hu));
              if (parts.length) description += ` ${parts.join(", ")}`;
              description += ".";
              const conclusion = `${conclusionPrefix} солідного легеневого вузлика ${site.genitive}.`;
              return { description, conclusion };
            },
          },
        ],
      },
      {
        id: "pleura",
        label: "Плевральна порожнина",
        laterality: true,
        lateralBase: { right: "справа", left: "зліва", bilateral: "з обох боків" },
        lateralSite: {
          right: { locative: "правій плевральній порожнині", genitive: "правої плевральної порожнини" },
          left: { locative: "лівій плевральній порожнині", genitive: "лівої плевральної порожнини" },
          bilateral: { locative: "обох плевральних порожнинах", genitive: "обох плевральних порожнин" },
        },
        findings: [
          {
            id: "effusion",
            label: "Вільна рідина (гідроторакс)",
            laterality: true,
            build: ({ site, conclusionPrefix }) => ({
              description: `У ${site.locative} визначається вільна рідина.`,
              conclusion: `${conclusionPrefix} наявності вільної рідини у ${site.genitive}.`,
            }),
          },
        ],
      },
    ],
  },
  {
    key: "ct_brain",
    label: "КТ головного мозку",
    conclusionPrefix: "КТ-ознаки",
    targets: [
      {
        id: "brain",
        label: "Речовина головного мозку",
        laterality: true,
        lateralSite: {
          right: { locative: "правій півкулі головного мозку", genitive: "правої півкулі головного мозку" },
          left: { locative: "лівій півкулі головного мозку", genitive: "лівої півкулі головного мозку" },
          bilateral: { locative: "обох півкулях головного мозку", genitive: "обох півкуль головного мозку" },
        },
        fixedSite: { locative: "речовині головного мозку", genitive: "речовини головного мозку" },
        findings: [
          {
            id: "ischemia",
            label: "Вогнище зниженої щільності (ішемія)",
            laterality: true,
            measurements: ["sizeMm", "hu"],
            build: ({ site, measurements, conclusionPrefix }) => {
              let description = `У ${site.locative} визначається вогнище зниженої щільності`;
              const parts: string[] = [];
              if (typeof measurements.sizeMm === "number") parts.push(measurementClause("sizeMm", measurements.sizeMm));
              if (typeof measurements.hu === "number") parts.push(measurementClause("hu", measurements.hu));
              if (parts.length) description += ` ${parts.join(", ")}`;
              description += ".";
              const conclusion = `${conclusionPrefix} вогнища зниженої щільності ${site.genitive} (імовірно ішемічного генезу).`;
              return { description, conclusion };
            },
          },
          {
            id: "hemorrhage",
            label: "Ділянка підвищеної щільності (крововилив)",
            laterality: true,
            measurements: ["sizeMm", "hu"],
            build: ({ site, measurements, conclusionPrefix }) => {
              let description = `У ${site.locative} визначається ділянка підвищеної щільності`;
              const parts: string[] = [];
              if (typeof measurements.sizeMm === "number") parts.push(measurementClause("sizeMm", measurements.sizeMm));
              if (typeof measurements.hu === "number") parts.push(measurementClause("hu", measurements.hu));
              if (parts.length) description += ` ${parts.join(", ")}`;
              description += ", що відповідає крововиливу.";
              const conclusion = `${conclusionPrefix} крововиливу ${site.genitive}.`;
              return { description, conclusion };
            },
          },
          {
            id: "midline_shift",
            label: "Зміщення серединних структур",
            laterality: true,
            measurements: ["shiftMm"],
            build: ({ site, measurements, conclusionPrefix }) => {
              const sideWord = site.locative.includes("правій") ? "ліворуч"
                : site.locative.includes("лівій") ? "праворуч" : "";
              let description = "Серединні структури зміщені";
              if (sideWord) description += ` ${sideWord}`;
              if (typeof measurements.shiftMm === "number") description += ` ${measurementClause("shiftMm", measurements.shiftMm)}`;
              description += ".";
              const conclusion = `${conclusionPrefix} зміщення серединних структур${typeof measurements.shiftMm === "number" ? ` на ${fmtNumber(measurements.shiftMm)} мм` : ""}.`;
              return { description, conclusion };
            },
          },
        ],
      },
    ],
  },
  {
    key: "ct_abdomen",
    label: "КТ органів черевної порожнини",
    conclusionPrefix: "КТ-ознаки",
    targets: [
      {
        id: "liver",
        label: "Печінка",
        laterality: false,
        fixedSite: { locative: "печінці", genitive: "печінки" },
        findings: [
          {
            id: "focal_lesion",
            label: "Вогнищеве утворення",
            needsContrast: true,
            measurements: ["sizeMm", "hu"],
            build: ({ site, measurements, conclusionPrefix }) => {
              let description = `У ${site.locative} визначається вогнищеве утворення`;
              const parts: string[] = [];
              if (typeof measurements.sizeMm === "number") parts.push(measurementClause("sizeMm", measurements.sizeMm));
              if (typeof measurements.hu === "number") parts.push(measurementClause("hu", measurements.hu));
              if (parts.length) description += ` ${parts.join(", ")}`;
              description += ".";
              const conclusion = `${conclusionPrefix} вогнищевого утворення ${site.genitive}, що потребує уточнення.`;
              return { description, conclusion };
            },
          },
        ],
      },
      {
        id: "kidney",
        label: "Нирка",
        laterality: true,
        lateralSite: {
          right: { locative: "правій нирці", genitive: "правої нирки" },
          left: { locative: "лівій нирці", genitive: "лівої нирки" },
          bilateral: { locative: "обох нирках", genitive: "обох нирок" },
        },
        findings: [
          {
            id: "stone",
            label: "Конкремент",
            laterality: true,
            measurements: ["sizeMm", "hu"],
            build: ({ site, measurements, conclusionPrefix }) => {
              let description = `У ${site.locative} визначається конкремент`;
              const parts: string[] = [];
              if (typeof measurements.sizeMm === "number") parts.push(measurementClause("sizeMm", measurements.sizeMm));
              if (typeof measurements.hu === "number") parts.push(measurementClause("hu", measurements.hu));
              if (parts.length) description += ` ${parts.join(", ")}`;
              description += ".";
              const conclusion = `${conclusionPrefix} конкремента ${site.genitive}.`;
              return { description, conclusion };
            },
          },
        ],
      },
      {
        id: "free_fluid",
        label: "Вільна рідина",
        laterality: false,
        fixedSite: { locative: "черевній порожнині", genitive: "черевної порожнини" },
        findings: [
          {
            id: "ascites",
            label: "Вільна рідина у черевній порожнині",
            measurements: ["volumeMl"],
            build: ({ site, measurements, conclusionPrefix }) => {
              let description = `У ${site.locative} визначається вільна рідина`;
              if (typeof measurements.volumeMl === "number") description += ` орієнтовним ${measurementClause("volumeMl", measurements.volumeMl)}`;
              description += ".";
              const conclusion = `${conclusionPrefix} наявності вільної рідини у ${site.genitive}.`;
              return { description, conclusion };
            },
          },
        ],
      },
    ],
  },
];

// ── Пошук у каталозі ─────────────────────────────────────────────────────────
export function regionByKey(key: string): RegionDef | undefined {
  return FINDINGS_CATALOG.find((region) => region.key === key);
}
function targetById(region: RegionDef, id: string): TargetDef | undefined {
  return region.targets.find((target) => target.id === id);
}
function findingById(target: TargetDef, id: string): FindingDef | undefined {
  return target.findings.find((finding) => finding.id === id);
}

// ── Розвʼязання анатомічної ділянки у потрібні відмінки ───────────────────────
function resolveSite(target: TargetDef, selection: FindingSelection): Site | { error: string } {
  const laterality: Laterality = selection.laterality || "none";

  // Легенева ділянка: сторона (+ частка + сегмент). Сегменти — у прийменниковому
  // відмінку для опису і в родовому для висновку; частка і легеня — в родовому.
  if (target.lateralBase && target.lobes) {
    if (laterality === "none") return { error: "Для легеневої знахідки вкажіть сторону" };
    const lungGen = target.lateralBase[laterality];
    if (!lungGen) return { error: "Невідома сторона" };
    const lobe = selection.lobeId ? target.lobes.find((entry) => entry.id === selection.lobeId) : undefined;
    const segment = selection.segmentId && target.segmentPresets
      ? target.segmentPresets.find((entry) => entry.id === selection.segmentId)
      : undefined;
    if (segment) {
      const tail = [lobe?.genitive, lungGen].filter(Boolean).join(" ");
      return { locative: `${segment.locative} ${tail}`.trim(), genitive: `${segment.genitive} ${tail}`.trim() };
    }
    if (lobe) {
      return { locative: `${lobe.locative} ${lungGen}`, genitive: `${lobe.genitive} ${lungGen}` };
    }
    const whole = target.lateralSite?.[laterality];
    if (whole) return whole;
    return { error: "Не вдалося визначити легеневу ділянку" };
  }

  // Латералізований орган (нирка, півкуля, плевральна порожнина).
  if (target.laterality && laterality !== "none") {
    const site = target.lateralSite?.[laterality];
    if (site) return site;
    return { error: "Для цієї знахідки вкажіть сторону" };
  }

  // Нелатералізований орган.
  if (target.fixedSite) return target.fixedSite;

  // Латералізований орган, але сторону не задано — вимагаємо її.
  if (target.laterality) return { error: "Вкажіть сторону (справа / зліва / двобічно)" };
  return { error: "Не вдалося визначити анатомічну ділянку" };
}

export type ComposeResult = { ok: true; finding: ComposedFinding } | { ok: false; error: string };

// Основна функція: із структурованого вибору складає опис і висновок.
export function composeFinding(selection: FindingSelection): ComposeResult {
  const region = regionByKey(selection.regionKey);
  if (!region) return { ok: false, error: "Невідома ділянка дослідження" };
  const target = targetById(region, selection.targetId);
  if (!target) return { ok: false, error: "Невідомий орган / структура" };
  const finding = findingById(target, selection.findingId);
  if (!finding) return { ok: false, error: "Невідома знахідка" };

  const site = resolveSite(target, selection);
  if ("error" in site) return { ok: false, error: site.error };

  const measurements: MeasurementInput = {};
  const allowed = finding.measurements || [];
  for (const kind of allowed) {
    const value = selection.measurements?.[kind];
    if (typeof value === "number" && Number.isFinite(value)) measurements[kind] = value;
  }

  const chosenIds = selection.modifierIds || [];
  const modifiers = (finding.modifiers || []).filter((modifier) => chosenIds.includes(modifier.id));
  // Взаємовиключні модифікатори не можна додавати разом.
  for (const modifier of modifiers) {
    for (const conflictId of modifier.conflictsWith || []) {
      if (chosenIds.includes(conflictId)) {
        return { ok: false, error: `Модифікатори «${modifier.label}» не можна поєднувати` };
      }
    }
  }

  const laterality: Laterality = finding.laterality === false ? "none" : (selection.laterality || "none");
  const { description, conclusion } = finding.build({
    site,
    measurements,
    modifiers,
    conclusionPrefix: region.conclusionPrefix,
  });

  return {
    ok: true,
    finding: {
      regionKey: region.key,
      targetId: target.id,
      findingId: finding.id,
      laterality,
      description: description.replace(/\s+/g, " ").trim(),
      conclusion: conclusion.replace(/\s+/g, " ").trim(),
    },
  };
}

// ── Вставлення у документ (append, НЕ overwrite) ──────────────────────────────
function appendLine(base: string, line: string): string {
  const trimmedBase = base.replace(/\s+$/, "");
  const target = line.trim();
  if (!target) return base;
  // Не дублюємо вже наявне речення (напр. повторна вставка тієї ж знахідки).
  const existing = trimmedBase.split("\n").map((entry) => entry.trim());
  if (existing.includes(target)) return base;
  return trimmedBase ? `${trimmedBase}\n${target}` : target;
}

// Додає складену знахідку у вільні поля документа, зберігаючи наявний текст.
export function insertComposedFinding(document: ProtocolDocument, finding: ComposedFinding): ProtocolDocument {
  return {
    ...document,
    findings: appendLine(document.findings, finding.description),
    conclusion: appendLine(document.conclusion, finding.conclusion),
  };
}

// ── Клінічні перевірки (§10) ─────────────────────────────────────────────────
export type ClinicalWarningCode =
  | "laterality_conflict"
  | "norm_with_pathology"
  | "dynamics_without_prior"
  | "contrast_missing_for_characterization";

export type ClinicalWarning = { code: ClinicalWarningCode; message: string };

// Відображення «орган знахідки → секція/поле норми в шаблоні» для трьох MVP-
// ділянок. Дозволяє помітити норму, що лишилась у структурованому полі попри
// додану патологію того самого органа (§10).
const NORM_FIELD_MAP: Record<string, Record<string, { sectionKey: string; fieldKey: string }>> = {
  ct_chest: {
    lung: { sectionKey: "lungs", fieldKey: "parenchyma" },
    pleura: { sectionKey: "lungs", fieldKey: "pleura" },
  },
  ct_brain: {
    brain: { sectionKey: "brain", fieldKey: "parenchyma" },
  },
  ct_abdomen: {
    liver: { sectionKey: "parenchymal", fieldKey: "liver" },
    kidney: { sectionKey: "parenchymal", fieldKey: "kidneys" },
    free_fluid: { sectionKey: "other", fieldKey: "fluid" },
  },
};

const DYNAMICS_PATTERNS = [
  /у\s+динаміц/i,
  /в\s+динаміц/i,
  /порівняно\s+з\s+попередн/i,
  /порівняно\s+з\s+попере/i,
  /відносно\s+попередн/i,
  /без\s+динамік/i,
];

export type ReviewInput = {
  document: ProtocolDocument;
  findings: ComposedFinding[];
  hasPriorStudy?: boolean;
};

// Перевіряє узгодженість протоколу зі структурованих знахідок + тексту.
// Повертає лише чесні, детерміновані сигнали — не блокує збереження.
export function reviewProtocol(input: ReviewInput): ClinicalWarning[] {
  const warnings: ClinicalWarning[] = [];
  const { document, findings } = input;

  // 1. Конфлікт латералізації: та сама знахідка одного органа і «справа», і
  // «зліва» окремими записами замість «двобічно».
  const byKey = new Map<string, Set<Laterality>>();
  for (const finding of findings) {
    const key = `${finding.regionKey}:${finding.targetId}:${finding.findingId}`;
    const set = byKey.get(key) || new Set<Laterality>();
    set.add(finding.laterality);
    byKey.set(key, set);
  }
  for (const [, sides] of byKey) {
    if (sides.has("right") && sides.has("left")) {
      warnings.push({
        code: "laterality_conflict",
        message: "Та сама знахідка додана і справа, і зліва окремо — розгляньте формулювання «двобічно».",
      });
      break;
    }
  }

  // 2. Норма органа лишилась у структурованому полі попри додану патологію.
  const normMap = NORM_FIELD_MAP[document.templateKey] || {};
  const seenTargets = new Set(findings.map((finding) => finding.targetId));
  for (const targetId of seenTargets) {
    const mapping = normMap[targetId];
    if (!mapping) continue;
    const value = (document.sections[mapping.sectionKey] || {})[mapping.fieldKey] || "";
    const lower = value.toLowerCase();
    const looksNormal = /без|не виявлено|не визначаєть|в межах норми|збережен|не змінен|прозор|не розширен|не збільшен/.test(lower);
    if (value.trim() && looksNormal) {
      warnings.push({
        code: "norm_with_pathology",
        message: `Для органа «${targetId}» у структурованому полі лишилася норма, хоча додано патологічну знахідку — відредагуйте поле норми.`,
      });
    }
  }

  // 3. Згадка динаміки без попереднього дослідження.
  if (!input.hasPriorStudy) {
    const text = `${document.findings}\n${document.conclusion}`;
    if (DYNAMICS_PATTERNS.some((pattern) => pattern.test(text))) {
      warnings.push({
        code: "dynamics_without_prior",
        message: "У тексті згадано динаміку, але попереднє дослідження не вказано — динаміку можна оцінювати лише за наявності порівняння.",
      });
    }
  }

  // 4. Характеристика утворення, що потребує контрастування, на нативному КТ.
  const contrastField = (document.sections.parameters || {}).contrast || "";
  const nonContrast = contrastField.trim() === "Без контрастування";
  if (nonContrast) {
    for (const finding of findings) {
      const region = regionByKey(finding.regionKey);
      const target = region && targetById(region, finding.targetId);
      const def = target && findingById(target, finding.findingId);
      if (def?.needsContrast) {
        warnings.push({
          code: "contrast_missing_for_characterization",
          message: "Дослідження без контрастування — характеристика виявленого утворення може бути неповною; зважте доцільність контрастного дослідження.",
        });
        break;
      }
    }
  }

  return warnings;
}
