// SEO-аудит публічних сторінок — чиста логіка (без залежностей, без IO).
// Робить правила docs/seo.md виконуваними: унікальний title/description,
// довжина, canonical, локальні ключові слова, «тонкий» контент, брендовий
// суфікс. Вхід — декларативні записи сторінок (напр. із lib/seo-service-pages),
// тож аудит працює офлайн і на Worker (без читання файлів).

export type SeoSeverity = "error" | "warn" | "info";

export type SeoPageInput = {
  path: string;
  title: string; // те, що піде у <title>
  description: string;
  bodyText?: string; // видимий контент для перевірки на «тонкість»
};

export type SeoIssue = {
  rule: string;
  label: string;
  severity: SeoSeverity;
  path: string;
  detail: string;
};

// Пороги (типова SEO-практика для пошукового сніпета).
export const SEO_LIMITS = {
  titleMin: 15,
  titleMax: 60,
  descMin: 70,
  descMax: 160,
  thinContent: 200, // символів видимого тексту
} as const;

// Локальні сутності (docs/seo.md → «Локальне SEO»). Хоч одна має бути присутня
// в title+description, інакше сторінка слабка для гео-запиту.
export const LOCAL_KEYWORDS = ["Чернігів", "Чернігові", "госпітал"];

// Бренд, який має завершувати title публічних сторінок.
export const BRAND = "RadiologyOS";

export type SeoRuleMeta = { label: string; severity: SeoSeverity; help: string };

export const SEO_RULES: Record<string, SeoRuleMeta> = {
  "title-missing": { label: "Немає <title>", severity: "error", help: "Кожна сторінка мусить мати унікальний заголовок." },
  "title-duplicate": { label: "Дубльований <title>", severity: "error", help: "Однаковий заголовок на кількох сторінках плутає пошук." },
  "title-length": { label: "Довжина <title>", severity: "warn", help: `Тримайте у межах ${SEO_LIMITS.titleMin}–${SEO_LIMITS.titleMax} символів.` },
  "title-brand": { label: "Немає бренду в <title>", severity: "info", help: `Завершуйте заголовок «${BRAND}» для впізнаваності.` },
  "desc-missing": { label: "Немає meta description", severity: "error", help: "Опис формує сніпет у видачі." },
  "desc-duplicate": { label: "Дубльований опис", severity: "error", help: "Опис має бути унікальним для кожної сторінки." },
  "desc-length": { label: "Довжина опису", severity: "warn", help: `Тримайте у межах ${SEO_LIMITS.descMin}–${SEO_LIMITS.descMax} символів.` },
  "path-duplicate": { label: "Дубльований шлях", severity: "error", help: "Дві сторінки з однаковим canonical-шляхом." },
  "local-keyword": { label: "Немає локального ключа", severity: "warn", help: `Згадайте гео-сутність (${LOCAL_KEYWORDS.join(" / ")}).` },
  "thin-content": { label: "Тонкий контент", severity: "warn", help: `Менше ${SEO_LIMITS.thinContent} символів видимого тексту.` },
};

const norm = (s: string) => (s || "").trim();
const lower = (s: string) => norm(s).toLowerCase();

function pushIssue(out: SeoIssue[], rule: string, path: string, detail: string) {
  const meta = SEO_RULES[rule];
  out.push({ rule, label: meta.label, severity: meta.severity, path, detail });
}

export function auditSeoPages(pages: SeoPageInput[]): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Індекси для виявлення дублікатів (за нормалізованим значенням).
  const byTitle = new Map<string, string[]>();
  const byDesc = new Map<string, string[]>();
  const byPath = new Map<string, string[]>();
  for (const p of pages) {
    const t = lower(p.title);
    const d = lower(p.description);
    const pt = lower(p.path);
    if (t) (byTitle.get(t) || byTitle.set(t, []).get(t)!).push(p.path);
    if (d) (byDesc.get(d) || byDesc.set(d, []).get(d)!).push(p.path);
    if (pt) (byPath.get(pt) || byPath.set(pt, []).get(pt)!).push(p.path);
  }
  const dupSet = (m: Map<string, string[]>) => {
    const s = new Set<string>();
    for (const paths of m.values()) if (paths.length > 1) for (const p of paths) s.add(p);
    return s;
  };
  const dupTitles = dupSet(byTitle);
  const dupDescs = dupSet(byDesc);
  const dupPaths = dupSet(byPath);

  for (const p of pages) {
    const title = norm(p.title);
    const desc = norm(p.description);
    const body = norm(p.bodyText || "");

    if (!title) {
      pushIssue(issues, "title-missing", p.path, "порожній заголовок");
    } else {
      if (title.length < SEO_LIMITS.titleMin || title.length > SEO_LIMITS.titleMax) {
        pushIssue(issues, "title-length", p.path, `${title.length} символів`);
      }
      if (!lower(title).includes(BRAND.toLowerCase())) {
        pushIssue(issues, "title-brand", p.path, "без бренду");
      }
      if (dupTitles.has(p.path)) {
        pushIssue(issues, "title-duplicate", p.path, `«${title}»`);
      }
    }

    if (!desc) {
      pushIssue(issues, "desc-missing", p.path, "порожній опис");
    } else {
      if (desc.length < SEO_LIMITS.descMin || desc.length > SEO_LIMITS.descMax) {
        pushIssue(issues, "desc-length", p.path, `${desc.length} символів`);
      }
      if (dupDescs.has(p.path)) {
        pushIssue(issues, "desc-duplicate", p.path, "опис повторюється");
      }
    }

    if (dupPaths.has(p.path)) {
      pushIssue(issues, "path-duplicate", p.path, "шлях повторюється");
    }

    const haystack = lower(`${title} ${desc}`);
    if (!LOCAL_KEYWORDS.some((k) => haystack.includes(k.toLowerCase()))) {
      pushIssue(issues, "local-keyword", p.path, "немає гео-сутності");
    }

    if (p.bodyText !== undefined && body.length < SEO_LIMITS.thinContent) {
      pushIssue(issues, "thin-content", p.path, `${body.length} символів`);
    }
  }

  return sortIssues(issues);
}

const SEVERITY_ORDER: Record<SeoSeverity, number> = { error: 0, warn: 1, info: 2 };

export function sortIssues(issues: SeoIssue[]): SeoIssue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.rule.localeCompare(b.rule),
  );
}

export type SeoSummary = {
  pages: number;
  score: number; // 0..100
  errors: number;
  warns: number;
  infos: number;
  byRule: { rule: string; label: string; severity: SeoSeverity; count: number }[];
  cleanPages: number;
};

// Health-score: 100 мінус зважені штрафи (error 6 / warn 2 / info 0.5),
// нормовано на кількість сторінок, щоб бал не залежав від розміру сайту.
const PENALTY: Record<SeoSeverity, number> = { error: 6, warn: 2, info: 0.5 };

export function summarizeSeo(issues: SeoIssue[], pages: number): SeoSummary {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warn").length;
  const infos = issues.filter((i) => i.severity === "info").length;

  const penalty = issues.reduce((sum, i) => sum + PENALTY[i.severity], 0);
  const denom = Math.max(1, pages);
  const score = Math.max(0, Math.round(100 - (penalty / denom) * 10));

  const ruleCounts = new Map<string, number>();
  for (const i of issues) ruleCounts.set(i.rule, (ruleCounts.get(i.rule) || 0) + 1);
  const byRule = [...ruleCounts.entries()]
    .map(([rule, count]) => ({ rule, label: SEO_RULES[rule].label, severity: SEO_RULES[rule].severity, count }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);

  const dirtyPaths = new Set(issues.map((i) => i.path));
  const cleanPages = Math.max(0, pages - dirtyPaths.size);

  return { pages, score, errors, warns, infos, byRule, cleanPages };
}
