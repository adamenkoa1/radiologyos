// Editable tariffs: catalog prices are the defaults. New overrides are stored
// in an organization-specific setting so different tenants can safely use the
// same service code with different prices. The legacy service_prices table is
// read only as a migration fallback for the initial organization.

import { SERVICES, serviceByCode } from "./catalog";
import { getSetting } from "./settings";

export interface TariffRow {
  code: string;
  title: string;
  group: string;
  defaultPrice: number;
  price: number;
  custom: boolean;
}

export const TARIFF_OVERRIDES_KEY = "service_price_overrides_v1";

export function tariffOverridesKey(organizationId: number): string {
  const id = Number.isInteger(organizationId) && organizationId > 0 ? organizationId : 1;
  return `${TARIFF_OVERRIDES_KEY}:org:${id}`;
}

export function sanitizePriceOverrides(input: unknown): Record<string, number> {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const out: Record<string, number> = {};
  for (const service of SERVICES) {
    if (!(service.code in source)) continue;
    const value = Number(source[service.code]);
    if (Number.isInteger(value) && value >= 0 && value <= 1_000_000 && value !== service.price) {
      out[service.code] = value;
    }
  }
  return out;
}

function parsePriceOverrides(stored: string): Record<string, number> {
  if (!stored) return {};
  try { return sanitizePriceOverrides(JSON.parse(stored)); }
  catch { return {}; }
}

async function legacyPriceOverrides(db: D1Database): Promise<Record<string, number>> {
  const rows = await db.prepare(
    "SELECT code, price FROM service_prices WHERE organization_id = 1",
  ).all<{ code: string; price: number }>();
  const map: Record<string, number> = {};
  for (const row of rows.results || []) map[String(row.code)] = Number(row.price);
  return map;
}

export async function priceOverrides(
  db: D1Database,
  organizationId = 1,
): Promise<Record<string, number>> {
  const stored = await getSetting(db, tariffOverridesKey(organizationId));
  if (stored) return parsePriceOverrides(stored);
  return organizationId === 1 ? legacyPriceOverrides(db) : {};
}

// Price actually charged for a service (override if set, otherwise catalog default).
export async function effectivePrice(
  db: D1Database,
  code: string,
  organizationId = 1,
): Promise<number> {
  const service = serviceByCode(code);
  if (!service) return 0;
  const overrides = await priceOverrides(db, organizationId);
  return overrides[code] ?? service.price;
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
