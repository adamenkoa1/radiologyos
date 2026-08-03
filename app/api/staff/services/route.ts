import { requireStaff } from "../../../../lib/staff-auth";
import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { getSetting, setSetting } from "../../../../lib/settings";
import { parseServiceConfig, sanitizeServiceConfig, SERVICE_CONFIG_KEY } from "../../../../lib/service-config";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const services = parseServiceConfig(await getSetting(db, SERVICE_CONFIG_KEY));
  return Response.json({ services, staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member || member.role !== "admin") return Response.json({ error: "Редагувати послуги може лише адміністратор" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { services?: unknown };
  const services = sanitizeServiceConfig(body.services);
  await setSetting(db, SERVICE_CONFIG_KEY, JSON.stringify(services));
  await audit(db, { organizationId: 1, actorEmail: member.email, action: "service_config_update", resource: "services" });
  return Response.json({ ok: true, services });
}
