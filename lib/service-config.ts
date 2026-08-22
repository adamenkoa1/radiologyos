import { SERVICES, type EquipmentType, type Service } from "./catalog";

export type ServiceConfigRecord = {
  code: string;
  equipmentId: EquipmentType;
  durationMinutes: number;
  active: boolean;
  military: boolean;
  civilian: boolean;
  requiresBooking: boolean;
  // Optional per-service overrides of the catalog wording. Absent/empty ⇒ the
  // catalog default (from Наказ №265) is used. Present ⇒ shown everywhere the
  // effective service is resolved (booking, cabinet, public price sync).
  title?: string;
  description?: string;
};

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 400;

export type ConfiguredService = Service & Omit<ServiceConfigRecord, "code">;

export const SERVICE_CONFIG_KEY = "service_catalog_config_v1";

export function serviceConfigKey(organizationId: number): string {
  const id = Number.isInteger(organizationId) && organizationId > 0 ? organizationId : 1;
  return `${SERVICE_CONFIG_KEY}:org:${id}`;
}

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
const SERVICE_CODES = new Set(SERVICES.map((service) => service.code));

export function validateServiceConfig(input: unknown): string {
  if (!Array.isArray(input)) return "Конфігурація послуг має бути списком";
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return "Некоректний запис послуги";
    const row = raw as Partial<ServiceConfigRecord>;
    const code = String(row.code || "");
    if (!SERVICE_CODES.has(code)) return `Невідомий код послуги: ${code || "(порожній)"}`;
    if (seen.has(code)) return `Код послуги дублюється: ${code}`;
    seen.add(code);
    if (row.equipmentId != null && !EQUIPMENT_IDS.has(row.equipmentId as EquipmentType)) {
      return `Некоректний апарат для послуги ${code}`;
    }
    if (row.durationMinutes != null) {
      const duration = Number(row.durationMinutes);
      if (!Number.isInteger(duration) || duration < 5 || duration > 360 || duration % 5 !== 0) {
        return `Некоректна тривалість для послуги ${code}`;
      }
    }
    if (row.title != null && (typeof row.title !== "string" || row.title.length > TITLE_MAX)) {
      return `Некоректна назва для послуги ${code}`;
    }
    if (row.description != null && (typeof row.description !== "string" || row.description.length > DESCRIPTION_MAX)) {
      return `Некоректний опис для послуги ${code}`;
    }
  }
  return "";
}

export function sanitizeServiceConfig(input: unknown): ServiceConfigRecord[] {
  const rows = Array.isArray(input) ? input : [];
  return SERVICE_CONFIG_DEFAULTS.map((base) => {
    const source = rows.find((row) => row && typeof row === "object" && String((row as { code?: unknown }).code || "") === base.code) as Partial<ServiceConfigRecord> | undefined;
    const equipmentId = EQUIPMENT_IDS.has(source?.equipmentId as EquipmentType) ? source!.equipmentId as EquipmentType : base.equipmentId;
    const duration = Number(source?.durationMinutes);
    // Keep title/description only when a non-empty override is provided, so an
    // empty field cleanly falls back to the catalog wording.
    const title = typeof source?.title === "string" ? source.title.trim().slice(0, TITLE_MAX) : "";
    const description = typeof source?.description === "string" ? source.description.trim().slice(0, DESCRIPTION_MAX) : "";
    return {
      code: base.code,
      equipmentId,
      durationMinutes: Number.isFinite(duration) ? Math.max(5, Math.min(360, Math.round(duration / 5) * 5)) : base.durationMinutes,
      active: typeof source?.active === "boolean" ? source.active : base.active,
      military: typeof source?.military === "boolean" ? source.military : base.military,
      civilian: typeof source?.civilian === "boolean" ? source.civilian : base.civilian,
      requiresBooking: typeof source?.requiresBooking === "boolean" ? source.requiresBooking : base.requiresBooking,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
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
