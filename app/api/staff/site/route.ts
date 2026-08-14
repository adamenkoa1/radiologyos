// Редактор вітрини (сайту клініки). `site_content` поки зберігається у
// legacy-global app_settings, тому службовий editor fail-closed доступний лише
// membership-admin основної/публічної організації до per-tenant міграції.

import { requireOrgContext } from "../../../../lib/tenant";
import { getSetting, setSetting } from "../../../../lib/settings";
import { SITE_CONTENT_KEY, parseSiteContent, sanitizeSiteContent } from "../../../../lib/site-content";
import { dbBinding } from "../../../../lib/db";

const PRIMARY_ORGANIZATION_ID = 1;

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.organizationId !== PRIMARY_ORGANIZATION_ID || ctx.role !== "admin") {
    return Response.json({ error: "Сайт клініки редагує лише адміністратор основної організації" }, { status: 403 });
  }

  const content = parseSiteContent(await getSetting(db, SITE_CONTENT_KEY));
  return Response.json({ content, staff: ctx.member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.organizationId !== PRIMARY_ORGANIZATION_ID || ctx.role !== "admin") {
    return Response.json({ error: "Змінювати сайт може лише адміністратор основної організації" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { content?: unknown };
  const content = sanitizeSiteContent(body.content);
  await setSetting(db, SITE_CONTENT_KEY, JSON.stringify(content));
  return Response.json({ ok: true, content }, { headers: { "cache-control": "no-store" } });
}
