// Public catalog with effective prices, grouped for the home-page tariff list.
// Military price is always 0 (free); the civilian price is the effective tariff.

import { SERVICES } from "../../../lib/catalog";
import { priceOverrides } from "../../../lib/tariffs";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET() {
  const db = dbBinding();
  const overrides = db ? await priceOverrides(db) : {};
  const order: string[] = [];
  const byGroup = new Map<string, Array<{ code: string; title: string; description: string; price: number }>>();
  for (const s of SERVICES) {
    if (!byGroup.has(s.group)) { byGroup.set(s.group, []); order.push(s.group); }
    byGroup.get(s.group)!.push({
      code: s.code, title: s.title, description: s.description,
      price: overrides[s.code] ?? s.price,
    });
  }
  const groups = order.map((group) => ({ group, items: byGroup.get(group)! }));
  return Response.json({ groups }, { headers: { "cache-control": "no-store" } });
}
