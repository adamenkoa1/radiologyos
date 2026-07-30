// Профілі організацій та feature flags — ядро SaaS-конструктора.
//
// Один і той самий код обслуговує різні профілі організацій. Профіль
// (`organization_profiles.profile_type`) задає набір увімкнених можливостей
// за замовчуванням; `feature_flags_json` дозволяє точково перевизначати їх для
// конкретної організації. Резолвер — єдине джерело правди «що ввімкнено».
//
// Профіль і прапорці читаються за organizationId зі серверного контексту
// (tenant-scoped), ніколи з тіла запиту.

import type { OrgContext } from "./tenant";

export const PROFILE_TYPES = ["hospital_radiology", "private_ct", "dental", "outpatient_clinic"] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export const PROFILE_LABELS: Record<ProfileType, string> = {
  hospital_radiology: "Госпітальна променева діагностика",
  private_ct: "Приватний КТ-центр",
  dental: "Стоматологічна діагностика",
  outpatient_clinic: "Амбулаторна клініка",
};

// Канонічні можливості, якими керує профіль/прапорці.
export const FEATURE_FLAGS = [
  "dicom_pacs",
  "protocols",
  "nszu",
  "contrast",
  "packages",
  "patient_cabinet",
  "reminders",
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const FEATURE_LABELS: Record<FeatureFlag, string> = {
  dicom_pacs: "DICOM / PACS",
  protocols: "Протоколи",
  nszu: "НСЗУ",
  contrast: "Контрастування",
  packages: "Пакетні послуги",
  patient_cabinet: "Кабінет пацієнта",
  reminders: "Автонагадування",
};

// Значення за замовчуванням для кожного профілю (deny-by-default: усе, що не
// перелічено як true, вважається вимкненим).
const PROFILE_DEFAULTS: Record<ProfileType, Partial<Record<FeatureFlag, boolean>>> = {
  hospital_radiology: { dicom_pacs: true, protocols: true, nszu: true, patient_cabinet: true, reminders: true },
  private_ct: { dicom_pacs: true, protocols: true, contrast: true, packages: true, patient_cabinet: true, reminders: true },
  dental: { protocols: true, packages: true, patient_cabinet: true, reminders: true },
  outpatient_clinic: { protocols: true, patient_cabinet: true, reminders: true },
};

// Короткий опис призначення кожного профілю (для сторінки конструктора).
export const PROFILE_DESCRIPTIONS: Record<ProfileType, string> = {
  hospital_radiology: "Госпітальне відділення: безоплатні (військові/НСЗУ) і платні дослідження, DICOM/PACS, протоколи, черга виконання.",
  private_ct: "Приватний КТ-центр: платний запис, контрастування, пакетні послуги, швидка видача результатів пацієнту.",
  dental: "Стоматологічна діагностика: протоколи, пакетні послуги, кабінет пацієнта; PACS зазвичай не потрібен.",
  outpatient_clinic: "Амбулаторна клініка: базові дослідження, протоколи, кабінет пацієнта й нагадування.",
};

// Рекомендовані (пресетні) прапорці профілю — дефолти профілю, розгорнуті у
// повний набір можливостей. Застосовуються як явні override-и організації.
export function profilePresetFlags(profileType: ProfileType): Record<FeatureFlag, boolean> {
  return resolveFlags(profileType, {});
}

export function isProfileType(value: string): value is ProfileType {
  return (PROFILE_TYPES as readonly string[]).includes(value);
}

export function isFeatureFlag(value: string): value is FeatureFlag {
  return (FEATURE_FLAGS as readonly string[]).includes(value);
}

export interface OrgProfile {
  profileType: ProfileType;
  profileLabel: string;
  flags: Record<FeatureFlag, boolean>;
  overrides: Partial<Record<FeatureFlag, boolean>>;
  settings: Record<string, unknown>;
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json || "{}");
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

// Обчислює ефективні прапорці: дефолти профілю, перекриті збереженими
// override-ами організації.
export function resolveFlags(profileType: ProfileType, overrides: Partial<Record<FeatureFlag, boolean>>): Record<FeatureFlag, boolean> {
  const defaults = PROFILE_DEFAULTS[profileType] || {};
  const flags = {} as Record<FeatureFlag, boolean>;
  for (const flag of FEATURE_FLAGS) {
    flags[flag] = flag in overrides ? Boolean(overrides[flag]) : Boolean(defaults[flag]);
  }
  return flags;
}

// Читає профіль організації контексту (tenant-scoped). Якщо запис відсутній —
// повертає безпечний госпітальний профіль за замовчуванням.
export async function getOrgProfile(db: D1Database, ctx: OrgContext): Promise<OrgProfile> {
  const row = await db.prepare(
    "SELECT profile_type AS profileType, feature_flags_json AS flagsJson, settings_json AS settingsJson FROM organization_profiles WHERE organization_id = ?"
  ).bind(ctx.organizationId).first<{ profileType: string; flagsJson: string; settingsJson: string }>();

  const profileType: ProfileType = row && isProfileType(row.profileType) ? row.profileType : "hospital_radiology";
  const rawOverrides = row ? safeParse(row.flagsJson) : {};
  const overrides: Partial<Record<FeatureFlag, boolean>> = {};
  for (const [key, value] of Object.entries(rawOverrides)) {
    if (isFeatureFlag(key)) overrides[key] = Boolean(value);
  }

  return {
    profileType,
    profileLabel: PROFILE_LABELS[profileType],
    flags: resolveFlags(profileType, overrides),
    overrides,
    settings: row ? safeParse(row.settingsJson) : {},
  };
}
