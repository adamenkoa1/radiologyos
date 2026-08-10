// Public catalog with effective prices and visibility, grouped for the price page.
// The effective service resolver is the only merge point for catalog defaults,
// organization configuration and tariff overrides.

import { effectiveServices } from "../../../lib/effective-services";
import { dbBinding } from "../../../lib/db";

export async function GET() {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });

  const services = await effectiveServices(db);
  const order: string[] = [];
  const byGroup = new Map<string, Array<{
    code: string;
    title: string;
    description: string;
    price: number;
    active: boolean;
    civilian: boolean;
    military: boolean;
    equipmentId: string;
    durationMinutes: number;
  }>>();

  for (const service of services) {
    if (!byGroup.has(service.group)) {
      byGroup.set(service.group, []);
      order.push(service.group);
    }
    byGroup.get(service.group)!.push({
      code: service.code,
      title: service.title,
      description: service.description,
      price: service.price,
      active: service.active,
      civilian: service.civilian,
      military: service.military,
      equipmentId: service.equipmentId,
      durationMinutes: service.durationMinutes,
    });
  }

  const groups = order.map((group) => ({ group, items: byGroup.get(group)! }));
  return Response.json({ groups }, { headers: { "cache-control": "no-store" } });
}
