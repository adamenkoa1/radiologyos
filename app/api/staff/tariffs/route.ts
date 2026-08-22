// Staff tariffs: view the full price list; admins can override prices per
// organization. New overrides live in an organization-specific setting; the
// legacy service_prices table remains read-only migration fallback for org 1.

import { SERVICES } from "../../../../lib/catalog";
import {
  sanitizePriceOverrides,
  tariffList,
  tariffOverridesKey,
} from "../../../../lib/tariffs";
import {
  parseServiceConfig,
  sanitizeServiceConfig,
  SERVICE_CONFIG_KEY,
  serviceConfigKey,
  validateServiceConfig,
} from "../../../../lib/service-config";
import { getSetting, setSetting } from "../../../../lib/settings";
import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  return Response.json(
    { tariffs: await tariffList(db, ctx.organizationId), staff: ctx.member },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.member.role !== "admin") {
    return Response.json({ error: "Змінювати тарифи може лише адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as {
    prices?: Record<string, unknown>;
    active?: Record<string, unknown>;
  };
  const prices = body.prices && typeof body.prices === "object" ? body.prices : {};
  const active = body.active && typeof body.active === "object" ? body.active : {};
  const knownCodes = new Set(SERVICES.map((service) => service.code));

  for (const [code, rawValue] of Object.entries(prices)) {
    if (!knownCodes.has(code)) {
      return Response.json({ error: `Невідомий код послуги ${code}` }, { status: 400 });
    }
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
      return Response.json({ error: `Некоректна ціна для послуги ${code}` }, { status: 400 });
    }
  }
  for (const code of Object.keys(active)) {
    if (!knownCodes.has(code)) {
      return Response.json({ error: `Невідомий код послуги ${code}` }, { status: 400 });
    }
  }

  const overrides = sanitizePriceOverrides(prices);
  await setSetting(db, tariffOverridesKey(ctx.organizationId), JSON.stringify(overrides));

  // Enabling/disabling a position lives in the service catalog config; apply the
  // toggles on top of the current config so price and availability stay in one place.
  if (Object.keys(active).length) {
    const tenantConfig = await getSetting(db, serviceConfigKey(ctx.organizationId));
    const legacyConfig = ctx.organizationId === 1 ? await getSetting(db, SERVICE_CONFIG_KEY) : "";
    const config = parseServiceConfig(tenantConfig || legacyConfig);
    const next = config.map((row) => (row.code in active ? { ...row, active: Boolean((active as Record<string, unknown>)[row.code]) } : row));
    const invalid = validateServiceConfig(next);
    if (invalid) return Response.json({ error: invalid }, { status: 400 });
    await setSetting(db, serviceConfigKey(ctx.organizationId), JSON.stringify(sanitizeServiceConfig(next)));
  }
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "tariff_update",
    resource: "tariffs",
  });

  return Response.json({ ok: true, tariffs: await tariffList(db, ctx.organizationId) });
}
