// Public tariff map for the static price page. Prices are resolved through the
// same effective-service source as booking and availability.

import { effectiveServices } from "../../../lib/effective-services";
import { dbBinding } from "../../../lib/db";

export async function GET() {
  const db = dbBinding();
  if (!db) return Response.json({ prices: {} });

  const prices: Record<string, number> = {};
  const titles: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  for (const service of await effectiveServices(db)) {
    prices[service.code] = service.price;
    titles[service.code] = service.title;
    descriptions[service.code] = service.description;
  }

  return Response.json({ prices, titles, descriptions }, { headers: { "cache-control": "no-store" } });
}
