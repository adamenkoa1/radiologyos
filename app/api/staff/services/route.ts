import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { effectiveServices } from "../../../../lib/effective-services";
import { getSetting, setSetting } from "../../../../lib/settings";
import {
  parseServiceConfig,
  sanitizeServiceConfig,
  validateServiceConfig,
  SERVICE_CONFIG_KEY,
  serviceConfigKey,
} from "../../../../lib/service-config";
import { requireOrgContext } from "../../../../lib/tenant";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  const tenantStored = await getSetting(db, serviceConfigKey(ctx.organizationId));
  const legacyStored = tenantStored ? "" : await getSetting(db, SERVICE_CONFIG_KEY);
  const services = parseServiceConfig(tenantStored || legacyStored);
  const effective = await effectiveServices(db, ctx.organizationId);
  return Response.json(
    { services, effectiveServices: effective, staff: ctx.member },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx || ctx.member.role !== "admin") {
    return Response.json({ error: "Редагувати послуги може лише адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { services?: unknown };
  const validationError = validateServiceConfig(body.services);
  if (validationError) return Response.json({ error: validationError }, { status: 400 });

  const services = sanitizeServiceConfig(body.services);
  await setSetting(db, serviceConfigKey(ctx.organizationId), JSON.stringify(services));
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "service_config_update",
    resource: "services",
  });
  return Response.json({ ok: true, services });
}
