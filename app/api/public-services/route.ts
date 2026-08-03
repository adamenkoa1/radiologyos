import { SERVICES } from "../../../lib/catalog";
import { dbBinding } from "../../../lib/db";
import { configuredService, parseServiceConfig, SERVICE_CONFIG_DEFAULTS, SERVICE_CONFIG_KEY } from "../../../lib/service-config";
import { getSetting } from "../../../lib/settings";

export async function GET() {
  const db = dbBinding();
  const config = db
    ? parseServiceConfig(await getSetting(db, SERVICE_CONFIG_KEY))
    : SERVICE_CONFIG_DEFAULTS;

  const services = SERVICES.map((service) => {
    const row = configuredService(service, config);
    return {
      code: row.code,
      availableToMilitary: row.active && row.military,
      availableToCivilian: row.active && row.civilian,
    };
  });

  return Response.json(
    { services },
    { headers: { "cache-control": "no-store" } },
  );
}
