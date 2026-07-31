// Public: price overrides for the static price list. Only changed prices are
// returned; the page keeps its built-in defaults for everything else.

import { priceOverrides } from "../../../lib/tariffs";
import { dbBinding } from "../../../lib/db";

export async function GET() {
  const db = dbBinding();
  if (!db) return Response.json({ prices: {} });
  return Response.json({ prices: await priceOverrides(db) }, { headers: { "cache-control": "no-store" } });
}
