// Editable tariffs: catalog prices are the defaults; an admin can override any
// service price for the current organization in the "Тарифи" tab.

import { SERVICES, serviceByCode } from "./catalog";
import { DEFAULT_ORGANIZATION_ID } from "./tenant";

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
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<Record<string, number>> {
  const rows = await db.prepare(
    "SELECT code, price FROM organization_service_prices WHERE organization_id = ?"
  ).bind(organizationId).all<{ code: string; price: number }>();
  const map: Record<string, number> = {};
  for (const row of rows.results || []) map[String(row.code)] = Number(row.price);
  return map;
}

// Price actually charged for a service (override if set, otherwise catalog default).
export async function effectivePrice(
  db: D1Database,
  code: string,
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<number> {
  const service = serviceByCode(code);
  if (!service) return 0;
  const row = await db.prepare(
    "SELECT price FROM organization_service_prices WHERE organization_id = ? AND code = ? LIMIT 1"
  ).bind(organizationId, code).first<{ price: number }>();
  return row ? Number(row.price) : service.price;
}

export async function tariffList(
  db: D1Database,
  organizationId = DEFAULT_ORGANIZATION_ID,
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
