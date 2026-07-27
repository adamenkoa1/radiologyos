import type { EquipmentType } from "./catalog";
import { serviceByCode } from "./catalog";

// Structured protocol builder. Templates live in code (like the service
// catalog); a filled protocol document is stored per booking in the
// `protocols` table. The same shape drives the editor, the print view and
// the plain-text rendering that later feeds export/AI tooling.

export type ProtocolFieldType = "line" | "text" | "select";

export type ProtocolField = {
  key: string;
  label: string;
  type: ProtocolFieldType;
  options?: string[];
  placeholder?: string;
  normal?: string;
};

export type ProtocolSection = {
  key: string;
  title: string;
  fields: ProtocolField[];
};

export type ProtocolTemplate = {
  key: string;
  title: string;
  equipmentId: EquipmentType;
  modalityLabel: string;
  method: string;
  sections: ProtocolSection[];
};

export type ProtocolStatus = "draft" | "ready" | "issued";

export type ProtocolSectionValues = Record<string, Record<string, string>>;

export type ProtocolDocument = {
  templateKey: string;
  method: string;
  sections: ProtocolSectionValues;
  findings: string;
  conclusion: string;
  recommendations: string;
  number: string;
  status: ProtocolStatus;
};

export const PROTOCOL_STATUSES: ProtocolStatus[] = ["draft", "ready", "issued"];

export const PROTOCOL_STATUS_LABELS: Record<ProtocolStatus, string> = {
  draft: "Чернетка",
  ready: "Готовий",
  issued: "Виданий",
};

// Field length guards used by both the API and the editor.
export const PROTOCOL_LIMITS = {
  method: 600,
  field: 2000,
  narrative: 6000,
  number: 80,
  maxFieldsPerSection: 40,
} as const;

const line = (key: string, label: string, normal?: string, placeholder?: string): ProtocolField =>
  ({ key, label, type: "line", normal, placeholder });
const area = (key: string, label: string, normal?: string, placeholder?: string): ProtocolField =>
  ({ key, label, type: "text", normal, placeholder });
const choice = (key: string, label: string, options: string[], normal?: string): ProtocolField =>
  ({ key, label, type: "select", options, normal });

const contrast: ProtocolField = choice(
  "contrast",
  "Контрастування",
  ["Без контрастування", "Внутрішньовенне контрастування", "Пероральне контрастування"],
  "Без контрастування",
);

export const PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
  {
    key: "ct_chest",
    title: "КТ органів грудної клітки",
    equipmentId: "ct",
    modalityLabel: "Комп’ютерна томографія",
    method: "Спіральне сканування органів грудної клітки з товщиною зрізу 1–3 мм, реконструкції у легеневому та м’якотканинному вікнах.",
    sections: [
      {
        key: "parameters",
        title: "Умови дослідження",
        fields: [contrast, line("kv", "Напруга / доза", "", "кВ, мАс, DLP")],
      },
      {
        key: "lungs",
        title: "Легені та плевра",
        fields: [
          area("parenchyma", "Легенева паренхіма", "Легеневі поля прозорі, без вогнищевих та інфільтративних змін."),
          line("nodules", "Вогнища / вузлики", "Не візуалізуються."),
          line("pleura", "Плевральні порожнини", "Вільної рідини та потовщень не виявлено."),
        ],
      },
      {
        key: "mediastinum",
        title: "Середостіння",
        fields: [
          line("lymphNodes", "Лімфатичні вузли", "Не збільшені."),
          line("vessels", "Магістральні судини", "Без особливостей."),
          line("heart", "Серце та перикард", "Розміри в межах норми, випоту немає."),
        ],
      },
      {
        key: "bones",
        title: "Кістки та м’які тканини",
        fields: [line("skeleton", "Кістковий каркас", "Деструктивних змін не виявлено.")],
      },
    ],
  },
  {
    key: "ct_brain",
    title: "КТ головного мозку",
    equipmentId: "ct",
    modalityLabel: "Комп’ютерна томографія",
    method: "Аксіальне сканування головного мозку з товщиною зрізу 1–5 мм від основи черепа до склепіння.",
    sections: [
      {
        key: "parameters",
        title: "Умови дослідження",
        fields: [contrast],
      },
      {
        key: "brain",
        title: "Речовина мозку",
        fields: [
          area("parenchyma", "Сіра та біла речовина", "Диференціація збережена, вогнищевих змін щільності не виявлено."),
          line("midline", "Серединні структури", "Не зміщені."),
          line("ventricles", "Шлуночкова система", "Не розширена, симетрична."),
          line("hemorrhage", "Крововилив", "Ознак гострого крововиливу не виявлено."),
        ],
      },
      {
        key: "structures",
        title: "Прилеглі структури",
        fields: [
          line("cisterns", "Базальні цистерни", "Простежуються, не деформовані."),
          line("bones", "Кістки черепа", "Без травматичних змін."),
          line("sinuses", "Приносові пазухи", "Пневматизація збережена."),
        ],
      },
    ],
  },
  {
    key: "ct_abdomen",
    title: "КТ органів черевної порожнини",
    equipmentId: "ct",
    modalityLabel: "Комп’ютерна томографія",
    method: "Сканування органів черевної порожнини та заочеревинного простору з товщиною зрізу 1–3 мм.",
    sections: [
      {
        key: "parameters",
        title: "Умови дослідження",
        fields: [contrast],
      },
      {
        key: "parenchymal",
        title: "Паренхіматозні органи",
        fields: [
          line("liver", "Печінка", "Розміри, щільність і структура в межах норми."),
          line("gallbladder", "Жовчний міхур", "Стінки не потовщені, конкрементів немає."),
          line("pancreas", "Підшлункова залоза", "Контури чіткі, структура однорідна."),
          line("spleen", "Селезінка", "Не збільшена, структура однорідна."),
          line("kidneys", "Нирки", "Розташування звичайне, конкрементів і об’ємних утворень немає."),
          line("adrenals", "Наднирники", "Не змінені."),
        ],
      },
      {
        key: "other",
        title: "Інші структури",
        fields: [
          line("bowel", "Порожнисті органи", "Без ознак патологічного потовщення стінок."),
          line("lymphNodes", "Лімфатичні вузли", "Не збільшені."),
          line("fluid", "Вільна рідина", "Не виявлено."),
        ],
      },
    ],
  },
  {
    key: "xray_chest",
    title: "Рентгенографія органів грудної клітки",
    equipmentId: "xray",
    modalityLabel: "Цифрова рентгенографія",
    method: "Оглядова рентгенографія органів грудної клітки у прямій проєкції.",
    sections: [
      {
        key: "findings",
        title: "Опис",
        fields: [
          area("lungs", "Легеневі поля", "Прозорі, без вогнищевих та інфільтративних тіней."),
          line("roots", "Корені легень", "Структурні, не розширені."),
          line("sinuses", "Синуси", "Вільні."),
          line("heart", "Серцево-судинна тінь", "Не розширена, конфігурація звичайна."),
          line("diaphragm", "Діафрагма", "Контури чіткі, розташування звичайне."),
        ],
      },
    ],
  },
  {
    key: "xray_bone",
    title: "Рентгенографія кісток і суглобів",
    equipmentId: "xray",
    modalityLabel: "Цифрова рентгенографія",
    method: "Рентгенографія досліджуваної ділянки у стандартних проєкціях.",
    sections: [
      {
        key: "findings",
        title: "Опис",
        fields: [
          line("region", "Ділянка дослідження", "", "Наприклад, правий променезап’ястковий суглоб"),
          area("bones", "Кісткова структура", "Цілісність кісток збережена, травматичних змін не виявлено."),
          line("joint", "Суглобові щілини", "Рівномірні, не звужені."),
          line("softTissue", "М’які тканини", "Без набряку та патологічних включень."),
        ],
      },
    ],
  },
  {
    key: "fluoro_chest",
    title: "Флюорографія органів грудної клітки",
    equipmentId: "fluoro",
    modalityLabel: "Цифрова флюорографія",
    method: "Цифрова флюорографія органів грудної клітки у прямій проєкції.",
    sections: [
      {
        key: "findings",
        title: "Опис",
        fields: [
          area("lungs", "Легеневі поля", "Без вогнищевих та інфільтративних змін."),
          line("roots", "Корені легень", "Структурні."),
          line("heart", "Серцево-судинна тінь", "У межах вікової норми."),
          line("diaphragm", "Діафрагма і синуси", "Без особливостей."),
        ],
      },
    ],
  },
  {
    key: "generic",
    title: "Універсальний протокол",
    equipmentId: "ct",
    modalityLabel: "Променеве дослідження",
    method: "",
    sections: [
      {
        key: "findings",
        title: "Опис",
        fields: [area("description", "Опис дослідження", "", "Детальний опис виявлених змін")],
      },
    ],
  },
];

export function protocolTemplateByKey(key: string | null | undefined): ProtocolTemplate {
  return PROTOCOL_TEMPLATES.find((template) => template.key === key)
    || PROTOCOL_TEMPLATES[PROTOCOL_TEMPLATES.length - 1];
}

export function isProtocolTemplate(key: string): boolean {
  return PROTOCOL_TEMPLATES.some((template) => template.key === key);
}

export function isProtocolStatus(value: string): value is ProtocolStatus {
  return (PROTOCOL_STATUSES as string[]).includes(value);
}

// Pick the most fitting template for a service without forcing the choice —
// the radiologist can still switch templates in the editor.
export function suggestTemplateKey(serviceCode: string): string {
  const service = serviceByCode(serviceCode);
  if (!service) return "generic";
  const title = service.title.toLowerCase();
  if (service.equipmentId === "fluoro") return "fluoro_chest";
  if (service.equipmentId === "xray") {
    return /грудної клітки|легень|органів грудної/.test(title) ? "xray_chest" : "xray_bone";
  }
  if (/головного мозку|голови|черепа/.test(title)) return "ct_brain";
  if (/грудної клітки/.test(title)) return "ct_chest";
  if (/черевної порожнини|живота|малого таза/.test(title)) return "ct_abdomen";
  return "generic";
}

// Prefill an empty document with the template's "normal" phrasing so the
// radiologist edits deviations instead of typing a full report each time.
export function normalDocument(templateKey: string): ProtocolDocument {
  const template = protocolTemplateByKey(templateKey);
  const sections: ProtocolSectionValues = {};
  for (const section of template.sections) {
    const values: Record<string, string> = {};
    for (const field of section.fields) if (field.normal) values[field.key] = field.normal;
    sections[section.key] = values;
  }
  return {
    templateKey: template.key,
    method: template.method,
    sections,
    findings: "",
    conclusion: "",
    recommendations: "",
    number: "",
    status: "draft",
  };
}

// Deterministic plain-text rendering shared by the print view, and later by
// export and AI drafting. Empty fields are skipped so the output stays clean.
export function renderProtocolText(document: ProtocolDocument): string {
  const template = protocolTemplateByKey(document.templateKey);
  const lines: string[] = [];
  lines.push(template.title.toUpperCase());
  if (document.number) lines.push(`Протокол № ${document.number}`);
  const method = (document.method || template.method).trim();
  if (method) lines.push("", `Методика: ${method}`);
  for (const section of template.sections) {
    const values = document.sections[section.key] || {};
    const rendered = section.fields
      .map((field) => ({ field, value: (values[field.key] || "").trim() }))
      .filter((entry) => entry.value);
    if (!rendered.length) continue;
    lines.push("", section.title.toUpperCase());
    for (const { field, value } of rendered) lines.push(`${field.label}: ${value}`);
  }
  if (document.findings.trim()) lines.push("", "ОПИС", document.findings.trim());
  if (document.conclusion.trim()) lines.push("", "ВИСНОВОК", document.conclusion.trim());
  if (document.recommendations.trim()) lines.push("", "РЕКОМЕНДАЦІЇ", document.recommendations.trim());
  return lines.join("\n");
}

export type ProtocolValidation = { ok: true; document: ProtocolDocument } | { ok: false; error: string };

// Sanitize and bound an incoming document before it is persisted. Returns a
// normalized document keyed strictly to the chosen template's fields.
export function sanitizeDocument(input: unknown): ProtocolValidation {
  if (!input || typeof input !== "object") return { ok: false, error: "Некоректні дані протоколу" };
  const raw = input as Record<string, unknown>;
  const templateKey = String(raw.templateKey || "generic");
  if (!isProtocolTemplate(templateKey)) return { ok: false, error: "Невідомий шаблон протоколу" };
  const status = String(raw.status || "draft");
  if (!isProtocolStatus(status)) return { ok: false, error: "Некоректний статус протоколу" };

  const clip = (value: unknown, max: number) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
  const number = clip(raw.number, PROTOCOL_LIMITS.number);
  const template = protocolTemplateByKey(templateKey);
  const incomingSections = (raw.sections && typeof raw.sections === "object")
    ? raw.sections as Record<string, unknown>
    : {};

  const sections: ProtocolSectionValues = {};
  for (const section of template.sections) {
    const incoming = incomingSections[section.key];
    const source = (incoming && typeof incoming === "object") ? incoming as Record<string, unknown> : {};
    const values: Record<string, string> = {};
    let count = 0;
    for (const field of section.fields) {
      const value = clip(source[field.key], PROTOCOL_LIMITS.field);
      if (!value) continue;
      if (++count > PROTOCOL_LIMITS.maxFieldsPerSection) break;
      if (field.type === "select" && field.options && !field.options.includes(value)) {
        return { ok: false, error: `Некоректне значення поля «${field.label}»` };
      }
      values[field.key] = value;
    }
    sections[section.key] = values;
  }

  const document: ProtocolDocument = {
    templateKey,
    method: clip(raw.method, PROTOCOL_LIMITS.method),
    sections,
    findings: clip(raw.findings, PROTOCOL_LIMITS.narrative),
    conclusion: clip(raw.conclusion, PROTOCOL_LIMITS.narrative),
    recommendations: clip(raw.recommendations, PROTOCOL_LIMITS.narrative),
    number,
    status,
  };

  if ((status === "ready" || status === "issued") && !number) {
    return { ok: false, error: "Для готового або виданого протоколу вкажіть його номер" };
  }
  if ((status === "ready" || status === "issued") && !document.conclusion) {
    return { ok: false, error: "Готовий протокол повинен містити висновок" };
  }
  return { ok: true, document };
}

// Map the document status onto the legacy booking.protocol_status vocabulary
// so existing reports and the queue keep working unchanged.
export function bookingProtocolStatus(status: ProtocolStatus): string {
  if (status === "issued") return "issued";
  if (status === "ready") return "ready";
  return "in_progress";
}
