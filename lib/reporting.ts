export type ReportTemplateKey = "studies" | "protocols" | "staff" | "equipment" | "finance";
export type ReportCell = string | number;
export type ReportRecord = Record<string, ReportCell>;

export type ReportColumn = {
  key: string;
  label: string;
  kind: "text" | "number" | "money";
  default: boolean;
};

export type ReportTemplate = {
  key: ReportTemplateKey;
  label: string;
  description: string;
  columns: ReportColumn[];
};

const column = (
  key:string,
  label:string,
  kind:ReportColumn["kind"] = "text",
  isDefault = true
): ReportColumn => ({ key, label, kind, default:isDefault });

export const REPORT_TEMPLATES: Record<ReportTemplateKey, ReportTemplate> = {
  studies: {
    key:"studies",
    label:"Реєстр досліджень",
    description:"Фактичне виконання, апарат, виконавці та кількість анатомічних ділянок.",
    columns:[
      column("date","Дата"),
      column("code","Код запису"),
      column("serviceCode","Код послуги"),
      column("service","Дослідження"),
      column("equipment","Обладнання"),
      column("status","Статус"),
      column("patientCategory","Маршрут"),
      column("radiologist","Лікар-рентгенолог"),
      column("radiographer","Рентгенолаборант"),
      column("performedAt","Фактично виконано"),
      column("regions","Анатомічні ділянки","number"),
      column("duration","Тривалість, хв","number"),
      column("externalReference","№ зовнішнього документа"),
    ],
  },
  protocols: {
    key:"protocols",
    label:"Контроль протоколів",
    description:"Готовність, видача та строки протоколів після виконаного дослідження.",
    columns:[
      column("code","Код запису"),
      column("service","Дослідження"),
      column("radiologist","Лікар-рентгенолог"),
      column("performedAt","Виконано"),
      column("protocolNumber","Номер протоколу"),
      column("protocolStatus","Статус протоколу"),
      column("protocolReadyAt","Готовий"),
      column("protocolIssuedAt","Виданий"),
      column("externalReference","№ зовнішнього документа"),
    ],
  },
  staff: {
    key:"staff",
    label:"Навантаження персоналу",
    description:"Кількість виконаних досліджень, ділянок і робочих хвилин по працівниках.",
    columns:[
      column("employee","Працівник"),
      column("role","Роль"),
      column("studies","Дослідження","number"),
      column("regions","Анатомічні ділянки","number"),
      column("minutes","Робочі хвилини","number"),
    ],
  },
  equipment: {
    key:"equipment",
    label:"Навантаження обладнання",
    description:"Виконані дослідження, час роботи, скасування та кількість ділянок.",
    columns:[
      column("equipment","Обладнання"),
      column("studies","Виконано","number"),
      column("completed","Завершено","number"),
      column("cancelled","Скасовано","number"),
      column("minutes","Зайнято, хв","number"),
      column("regions","Анатомічні ділянки","number"),
    ],
  },
  finance: {
    key:"finance",
    label:"Фінанси та НСЗУ",
    description:"Нарахована й фактично сплачена сума, спосіб оплати та статус НСЗУ.",
    columns:[
      column("date","Дата"),
      column("code","Код запису"),
      column("service","Дослідження"),
      column("patientCategory","Маршрут"),
      column("dueAmount","До сплати, грн","money"),
      column("paidAmount","Сплачено, грн","money"),
      column("paymentStatus","Статус оплати"),
      column("paymentMethod","Спосіб оплати"),
      column("nszuStatus","Статус НСЗУ"),
      column("nszuReference","№ підтвердження НСЗУ"),
    ],
  },
};

export function reportTemplate(value:string | null | undefined) {
  return REPORT_TEMPLATES[value as ReportTemplateKey] || REPORT_TEMPLATES.studies;
}

export function selectedReportColumns(template:ReportTemplate, value:string | null | undefined) {
  const requested = new Set(String(value || "").split(",").filter(Boolean));
  const selected = requested.size
    ? template.columns.filter((item) => requested.has(item.key))
    : template.columns.filter((item) => item.default);
  return selected.length ? selected : template.columns.filter((item) => item.default);
}

export function valueForColumn(row:ReportRecord,key:string):ReportCell {
  return row[key] ?? "";
}
