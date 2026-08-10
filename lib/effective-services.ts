import { SERVICES, type Service } from "./catalog";
import {
  configuredService,
  parseServiceConfig,
  SERVICE_CONFIG_KEY,
  type ConfiguredService,
} from "./service-config";
import { getSetting } from "./settings";
import { priceOverrides } from "./tariffs";

export type EffectiveService = ConfiguredService & {
  price: number;
  defaultPrice: number;
  customPrice: boolean;
};

/**
 * Canonical server-side service resolver.
 *
 * Every consumer should resolve title/equipment/duration/visibility and price
 * through this module instead of independently mixing catalog, service config
 * and tariff tables. The static catalog remains the seed/default definition.
 */
export async function effectiveServices(db: D1Database): Promise<EffectiveService[]> {
  const [storedConfig, overrides] = await Promise.all([
    getSetting(db, SERVICE_CONFIG_KEY),
    priceOverrides(db),
  ]);
  const config = parseServiceConfig(storedConfig);

  return SERVICES.map((service: Service) => {
    const configured = configuredService(service, config);
    const override = overrides[service.code];
    return {
      ...configured,
      defaultPrice: service.price,
      price: override ?? service.price,
      customPrice: override != null,
    };
  });
}

export async function effectiveServiceByCode(
  db: D1Database,
  code: string,
): Promise<EffectiveService | undefined> {
  const services = await effectiveServices(db);
  return services.find((service) => service.code === code);
}

export function serviceAvailableTo(
  service: EffectiveService,
  category: "civilian" | "military",
): boolean {
  return service.active && (category === "military" ? service.military : service.civilian);
}
