import type { PathologyFinding, LibraryParameter } from "./clinical-library";

// Рендер ЧЕРНЕТКИ тексту імпортованої знахідки з її шаблону + значень параметрів
// (MASTER PROMPT 4, Этап 4 / PR3 Builder Integration). Чистий, runtime-importable
// (без імпорту ./protocols/БД/мережі).
//
// Інваріанти: нічого не підставляється автоматично — лікар заповнює параметри й
// ЯВНО вставляє чернетку в опис/висновок (append, без перезапису). Якщо
// обов'язковий параметр порожній — текст НЕ формується (немає напів-порожніх
// абзаців: вимога «без порожніх абзаців»). Нічого не публікується; знахідка
// лишається draft_unvalidated до клінічної перевірки.

export type LibraryFindingValue = string | number;
export type LibraryFindingValues = Record<string, LibraryFindingValue>;

export type RenderResult =
  | { ok: true; description: string; conclusion: string }
  | { ok: false; missing: string[] };

const PLACEHOLDER_RE = /\{([a-z0-9_]+)\}/g;
const MINUS = "−"; // справжній мінус для денситометрії (−952 HU)

function usedPlaceholders(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) out.push(m[1]);
  return out;
}

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? MINUS : "";
  const abs = Math.abs(value);
  const rounded = Math.round(abs * 10) / 10;
  return `${sign}${Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",")}`;
}

function formatValue(param: LibraryParameter | undefined, raw: LibraryFindingValue): string {
  if (typeof raw === "number") return fmtNumber(raw);
  const s = String(raw).trim();
  if (param?.type === "number") {
    const n = Number(s.replace(",", "."));
    if (Number.isFinite(n)) return fmtNumber(n);
  }
  return s;
}

function isEmpty(raw: LibraryFindingValue | undefined): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw === "number") return !Number.isFinite(raw);
  return String(raw).trim() === "";
}

// Параметри, які реально використовуються як плейсхолдери в тексті знахідки.
export function activeParameters(finding: PathologyFinding): LibraryParameter[] {
  const used = new Set([
    ...usedPlaceholders(finding.description_template_uk),
    ...usedPlaceholders(finding.conclusion_template_uk),
  ]);
  return (finding.parameters || []).filter((p) => used.has(p.key));
}

export function renderLibraryFinding(finding: PathologyFinding, values: LibraryFindingValues): RenderResult {
  const paramByKey = new Map((finding.parameters || []).map((p) => [p.key, p]));
  const active = activeParameters(finding);

  // Обов'язкові активні параметри мають бути заповнені — інакше чернетку не
  // формуємо (без напів-порожніх речень).
  const missing = active.filter((p) => p.required && isEmpty(values[p.key])).map((p) => p.key);
  if (missing.length) return { ok: false, missing };

  const fill = (template: string): string =>
    template.replace(PLACEHOLDER_RE, (_whole, key: string) => {
      const raw = values[key];
      if (isEmpty(raw)) return `{${key}}`; // необов'язковий і порожній — лишаємо маркер як є
      return formatValue(paramByKey.get(key), raw as LibraryFindingValue);
    });

  return { ok: true, description: fill(finding.description_template_uk), conclusion: fill(finding.conclusion_template_uk) };
}
