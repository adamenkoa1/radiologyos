// SEO-аудит публічних сервісних сторінок (КТ / рентген / флюорографія).
// Робить правила docs/seo.md виконуваними: title/description, дублікати,
// довжина, локальні ключі, «тонкий» контент. Дані сторінок — декларативні
// (lib/seo-service-pages), тож аудит офлайн і не читає файли й не чіпає БД.
// Доступ — management-контекст (адміністратор або завідувач відділення).

import { requireManagementOrgContext } from "../../../../../lib/tenant";
import { dbBinding } from "../../../../../lib/db";
import { CT_SEO_PAGES, FLUORO_SEO_PAGE, XRAY_SEO_PAGE } from "../../../../../lib/seo-service-pages";
import type { SeoServicePage } from "../../../../../lib/seo-service-pages";
import { auditSeoPages, summarizeSeo, SEO_RULES, type SeoPageInput } from "../../../../../lib/seo-audit";

function toInput(page: SeoServicePage): SeoPageInput {
  return {
    path: page.path,
    title: page.metaTitle,
    description: page.description,
    // Видимий контент сторінки: вступ + підготовка + що взяти.
    bodyText: [page.intro, ...page.preparation, ...page.whatToBring].join(" "),
  };
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireManagementOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Звіт доступний адміністратору або завідувачу відділення" }, { status: 403 });

  const servicePages: SeoServicePage[] = [
    ...Object.values(CT_SEO_PAGES),
    XRAY_SEO_PAGE,
    FLUORO_SEO_PAGE,
  ];
  const inputs = servicePages.map(toInput);
  const issues = auditSeoPages(inputs);
  const summary = summarizeSeo(issues, inputs.length);

  const issuesByPath = new Map<string, number>();
  for (const i of issues) issuesByPath.set(i.path, (issuesByPath.get(i.path) || 0) + 1);

  const pages = inputs
    .map((p) => ({
      path: p.path,
      title: p.title,
      titleLen: p.title.trim().length,
      description: p.description,
      descLen: p.description.trim().length,
      issues: issuesByPath.get(p.path) || 0,
    }))
    .sort((a, b) => b.issues - a.issues || a.path.localeCompare(b.path));

  const rules = Object.fromEntries(
    Object.entries(SEO_RULES).map(([k, v]) => [k, { label: v.label, severity: v.severity, help: v.help }]),
  );

  const staff = { email: ctx.member.email, displayName: ctx.member.displayName, role: ctx.member.role };
  return Response.json({ summary, issues, pages, rules, staff });
}
