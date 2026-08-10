// Public tariff map for the static price page. Prices are resolved through the
// same effective-service source as booking and availability.

import { effectiveServices } from "../../../lib/effective-services";
import { dbBinding } from "../../../lib/db";

export async function GET() {
  const db = dbBinding();
  if (!db) return Response.json({ prices: {} });

  const prices: Record<string, number> = {};
  for (const service of await effectiveServices(db)) {
    prices[service.code] = service.price;
  }

  return Response.json({ prices }, { headers: { "cache-control": "no-store" } });
}
