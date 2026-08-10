// Editable tariffs: catalog prices are the defaults; an admin can override any
// service price in the "Тарифи" tab. Overrides live in `service_prices` and are
// always read through an explicit organization scope.

import { SERVICES, serviceByCode } from "./catalog";

export interface TariffRow {
  code: string;
  title: string;
  group: string;
  defaultPrice: number;
  price: number;
  custom: boolean;
}

export async function priceOverrides(
  db: D1Database,
  organizationId = 1,
): Promise<Record<string, number>> {
  const rows = await db.prepare(
    "SELECT code, price FROM service_prices WHERE organization_id = ?",
  ).bind(organizationId).all<{ code: string; price: number }>();
  const map: Record<string, number> = {};
  for (const row of rows.results || []) map[String(row.code)] = Number(row.price);
  return map;
}

// Price actually charged for a service (override if set, otherwise catalog default).
export async function effectivePrice(
  db: D1Database,
  code: string,
  organizationId = 1,
): Promise<number> {
  const service = serviceByCode(code);
  if (!service) return 0;
  const row = await db.prepare(
    "SELECT price FROM service_prices WHERE organization_id = ? AND code = ? LIMIT 1",
  ).bind(organizationId, code).first<{ price: number }>();
  return row ? Number(row.price) : service.price;
}

export async function tariffList(
  db: D1Database,
  organizationId = 1,
): Promise<TariffRow[]> {
  const overrides = await priceOverrides(db, organizationId);
  return SERVICES.map((service) => ({
    code: service.code,
    title: service.title,
    group: service.group,
    defaultPrice: service.price,
    price: overrides[service.code] ?? service.price,
    custom: overrides[service.code] != null,
  }));
}
