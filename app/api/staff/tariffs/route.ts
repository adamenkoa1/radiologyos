// Staff tariffs: view the full price list; admins can override prices per
// organization. New overrides live in an organization-specific setting; the
// legacy service_prices table remains read-only migration fallback for org 1.

import { SERVICES } from "../../../../lib/catalog";
import {
  sanitizePriceOverrides,
  tariffList,
  tariffOverridesKey,
} from "../../../../lib/tariffs";
import { setSetting } from "../../../../lib/settings";
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

  const body = await request.json().catch(() => ({})) as { prices?: Record<string, unknown> };
  const prices = body.prices && typeof body.prices === "object" ? body.prices : {};
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

  const overrides = sanitizePriceOverrides(prices);
  await setSetting(db, tariffOverridesKey(ctx.organizationId), JSON.stringify(overrides));
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "tariff_update",
    resource: "tariffs",
  });

  return Response.json({ ok: true, tariffs: await tariffList(db, ctx.organizationId) });
}
