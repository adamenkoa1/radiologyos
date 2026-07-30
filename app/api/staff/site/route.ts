// Редактор вітрини (сайту клініки) — лише адміністратор. Читає й зберігає
// налаштовуваний контент публічної сторінки у app_settings (ключ site_content).

import { requireStaff } from "../../../../lib/staff-auth";
import { getSetting, setSetting } from "../../../../lib/settings";
import { SITE_CONTENT_KEY, parseSiteContent, sanitizeSiteContent } from "../../../../lib/site-content";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Сайт клініки редагує лише адміністратор" }, { status: 403 });

  const content = parseSiteContent(await getSetting(db, SITE_CONTENT_KEY));
  return Response.json({ content, staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Змінювати сайт може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { content?: unknown };
  const content = sanitizeSiteContent(body.content);
  await setSetting(db, SITE_CONTENT_KEY, JSON.stringify(content));
  return Response.json({ ok: true, content }, { headers: { "cache-control": "no-store" } });
}
