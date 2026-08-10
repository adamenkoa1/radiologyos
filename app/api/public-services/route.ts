import { dbBinding } from "../../../lib/db";
import { effectiveServices } from "../../../lib/effective-services";

export async function GET() {
  const db = dbBinding();
  if (!db) {
    return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  }

  const services = (await effectiveServices(db)).map((service) => ({
    code: service.code,
    title: service.title,
    equipmentId: service.equipmentId,
    durationMinutes: service.durationMinutes,
    price: service.price,
    availableToMilitary: service.active && service.military,
    availableToCivilian: service.active && service.civilian,
  }));

  return Response.json(
    { services },
    { headers: { "cache-control": "no-store" } },
  );
}
