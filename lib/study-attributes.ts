// Структуровані параметри дослідження (booking): анатомічна ділянка (кілька) та
// метод контрастування. Єдине канонічне джерело вокабуляру — звідси беруть мітки
// контрастування і поля протоколу (lib/protocols.ts), щоб не плодити дубль-таксономію.
//
// Значення зберігаються стабільними КЛЮЧАМИ (не локалізованими рядками):
//   anatomical_regions — кома-розділені ключі ділянок (підтримка кількох);
//   contrast_method    — один ключ або '' (не вказано — явно порожнє, НЕ 'none').
// '' завжди означає «не вказано»; 'none' — явно «без контрастування».

export type AnatomicalRegionKey =
  | "head" | "sinuses" | "face" | "neck" | "spine" | "chest" | "abdomen"
  | "pelvis" | "upper_limb" | "lower_limb" | "hand_foot" | "joint" | "vessels" | "other";

export const ANATOMICAL_REGIONS:ReadonlyArray<{ key:AnatomicalRegionKey; label:string }> = [
  { key:"head", label:"Голова / череп" },
  { key:"sinuses", label:"Придаткові пазухи носа" },
  { key:"face", label:"Лицевий скелет" },
  { key:"neck", label:"Шия" },
  { key:"spine", label:"Хребет" },
  { key:"chest", label:"Грудна клітка" },
  { key:"abdomen", label:"Черевна порожнина" },
  { key:"pelvis", label:"Таз / кульшові суглоби" },
  { key:"upper_limb", label:"Верхня кінцівка" },
  { key:"lower_limb", label:"Нижня кінцівка" },
  { key:"hand_foot", label:"Кисть / стопа" },
  { key:"joint", label:"Суглоб" },
  { key:"vessels", label:"Судини (ангіо)" },
  { key:"other", label:"Інша ділянка" },
];

const REGION_LABEL = new Map<string,string>(ANATOMICAL_REGIONS.map((r) => [r.key, r.label]));
const REGION_KEYS = new Set<string>(ANATOMICAL_REGIONS.map((r) => r.key));
// Узгоджено з наявним обмеженням bookings.anatomical_regions_count (1..20).
export const MAX_ANATOMICAL_REGIONS = 20;

export type ContrastMethodKey = "" | "none" | "iv" | "oral";

// Мітки збігаються з наявними опціями поля протоколу — lib/protocols.ts бере їх
// звідси, тож таксономія одна. Ключ '' (не вказано) у списку опцій не фігурує.
export const CONTRAST_METHODS:ReadonlyArray<{ key:Exclude<ContrastMethodKey,"">; label:string }> = [
  { key:"none", label:"Без контрастування" },
  { key:"iv", label:"Внутрішньовенне контрастування" },
  { key:"oral", label:"Пероральне контрастування" },
];

const CONTRAST_LABEL = new Map<string,string>(CONTRAST_METHODS.map((c) => [c.key, c.label]));
const CONTRAST_KEYS = new Set<string>(CONTRAST_METHODS.map((c) => c.key));

// Мітки методів контрастування у канонічному порядку — для поля протоколу.
export const CONTRAST_METHOD_LABELS:string[] = CONTRAST_METHODS.map((c) => c.label);

export function regionLabel(key:string):string {
  return REGION_LABEL.get(key) || "";
}

// Приймає масив ключів або кома-рядок; лишає тільки відомі ключі, без дублів,
// у канонічному порядку, не більше MAX_ANATOMICAL_REGIONS. Невідоме відкидається.
export function sanitizeRegions(input:unknown):AnatomicalRegionKey[] {
  const raw:string[] = Array.isArray(input)
    ? input.map((v) => String(v))
    : typeof input === "string"
      ? input.split(",")
      : [];
  const seen = new Set<string>();
  for (const value of raw) {
    const key = value.trim().toLowerCase();
    if (REGION_KEYS.has(key)) seen.add(key);
  }
  return ANATOMICAL_REGIONS
    .map((r) => r.key)
    .filter((key) => seen.has(key))
    .slice(0, MAX_ANATOMICAL_REGIONS);
}

export function serializeRegions(input:unknown):string {
  return sanitizeRegions(input).join(",");
}

export function regionLabels(input:unknown):string[] {
  return sanitizeRegions(input).map((key) => REGION_LABEL.get(key) || key);
}

// Один ключ контрасту або '' (не вказано). Невідоме/порожнє → ''.
export function sanitizeContrast(input:unknown):ContrastMethodKey {
  const key = typeof input === "string" ? input.trim().toLowerCase() : "";
  return CONTRAST_KEYS.has(key) ? key as ContrastMethodKey : "";
}

export function contrastLabel(key:string):string {
  return CONTRAST_LABEL.get(key) || "";
}

// Людський опис параметрів для картки/друку. Порожнє (не вказано) не вигадуємо —
// повертаємо '' , щоб відображення могло показати «не вказано» явно.
export function describeStudyAttributes(regionsRaw:unknown, contrastRaw:unknown):{ regions:string[]; contrast:string } {
  return { regions:regionLabels(regionsRaw), contrast:contrastLabel(sanitizeContrast(contrastRaw)) };
}
