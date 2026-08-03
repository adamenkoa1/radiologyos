import { SERVICES, type EquipmentType, type Service } from "./catalog";

export type ServiceConfigRecord = {
  code: string;
  equipmentId: EquipmentType;
  durationMinutes: number;
  active: boolean;
  military: boolean;
  civilian: boolean;
  requiresBooking: boolean;
};

export type ConfiguredService = Service & Omit<ServiceConfigRecord, "code">;

export const SERVICE_CONFIG_KEY = "service_catalog_config_v1";

export const SERVICE_CONFIG_DEFAULTS: ServiceConfigRecord[] = SERVICES.map((service) => ({
  code: service.code,
  equipmentId: service.equipmentId,
  durationMinutes: service.durationMinutes,
  active: true,
  military: true,
  civilian: true,
  requiresBooking: service.equipmentId === "ct" || service.group.includes("Контраст"),
}));

const EQUIPMENT_IDS = new Set<EquipmentType>(["ct", "xray", "fluoro"]);

export function sanitizeServiceConfig(input: unknown): ServiceConfigRecord[] {
  const rows = Array.isArray(input) ? input : [];
  return SERVICE_CONFIG_DEFAULTS.map((base) => {
    const source = rows.find((row) => row && typeof row === "object" && String((row as { code?: unknown }).code || "") === base.code) as Partial<ServiceConfigRecord> | undefined;
    const equipmentId = EQUIPMENT_IDS.has(source?.equipmentId as EquipmentType) ? source!.equipmentId as EquipmentType : base.equipmentId;
    const duration = Number(source?.durationMinutes);
    return {
      code: base.code,
      equipmentId,
      durationMinutes: Number.isFinite(duration) ? Math.max(5, Math.min(360, Math.round(duration / 5) * 5)) : base.durationMinutes,
      active: typeof source?.active === "boolean" ? source.active : base.active,
      military: typeof source?.military === "boolean" ? source.military : base.military,
      civilian: typeof source?.civilian === "boolean" ? source.civilian : base.civilian,
      requiresBooking: typeof source?.requiresBooking === "boolean" ? source.requiresBooking : base.requiresBooking,
    };
  });
}

export function parseServiceConfig(stored: string): ServiceConfigRecord[] {
  if (!stored) return SERVICE_CONFIG_DEFAULTS.map((row) => ({ ...row }));
  try { return sanitizeServiceConfig(JSON.parse(stored)); }
  catch { return SERVICE_CONFIG_DEFAULTS.map((row) => ({ ...row })); }
}

export function configuredService(service: Service, config: ServiceConfigRecord[]): ConfiguredService {
  const row = config.find((item) => item.code === service.code) || SERVICE_CONFIG_DEFAULTS.find((item) => item.code === service.code)!;
  return { ...service, ...row };
}

export function configuredServiceByCode(code: string, config: ServiceConfigRecord[]): ConfiguredService | undefined {
  const service = SERVICES.find((item) => item.code === code);
  return service ? configuredService(service, config) : undefined;
}
