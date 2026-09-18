import { dbBinding } from "../../../../lib/db";
import {
  DEPARTMENT_STRUCTURE_KEY,
  parseDepartmentStructure,
  sanitizeDepartmentStructure,
} from "../../../../lib/department-structure";
import { SITE_CONTENT_KEY, parseSiteContent, sanitizeSiteContent } from "../../../../lib/site-content";
import { requireOrgContext } from "../../../../lib/tenant";
import { getSetting, setSetting } from "../../../../lib/settings";

// Department structure and site content are still legacy-global settings tied
// to the public organization. Until storage is tenantized, deny staff from any
// secondary tenant rather than showing/editing org 1's editor data.
const PRIMARY_ORGANIZATION_ID = 1;

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.organizationId !== PRIMARY_ORGANIZATION_ID) {
    return Response.json({ error: "Розділ доступний лише персоналу основної організації" }, { status: 403 });
  }
  const member = ctx.member;

  const [structureStored, siteStored] = await Promise.all([
    getSetting(db, DEPARTMENT_STRUCTURE_KEY),
    getSetting(db, SITE_CONTENT_KEY),
  ]);
  return Response.json({
    structure: parseDepartmentStructure(structureStored),
    siteContent: parseSiteContent(siteStored),
    staff: member,
    canEdit: member.role === "admin",
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.organizationId !== PRIMARY_ORGANIZATION_ID) {
    return Response.json({ error: "Розділ доступний лише персоналу основної організації" }, { status: 403 });
  }
  const member = ctx.member;
  if (member.role !== "admin") return Response.json({ error: "Редагувати структуру може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { structure?: unknown; siteContent?: unknown };
  const structure = sanitizeDepartmentStructure(body.structure);
  const siteContent = sanitizeSiteContent(body.siteContent);
  await Promise.all([
    setSetting(db, DEPARTMENT_STRUCTURE_KEY, JSON.stringify(structure)),
    setSetting(db, SITE_CONTENT_KEY, JSON.stringify(siteContent)),
  ]);
  return Response.json({ ok: true, structure, siteContent }, { headers: { "cache-control": "no-store" } });
}
