import { EQUIPMENT, serviceByCode } from "./catalog";
import { todayInKyiv } from "./booking-rules";
import {
  REPORT_TEMPLATES,
  ReportRecord,
  ReportTemplateKey,
  reportTemplate,
  selectedReportColumns,
} from "./reporting";

export type ReportFilters = {
  from:string;
  to:string;
  template:ReportTemplateKey;
  radiologist:string;
  radiographer:string;
  equipment:string;
  serviceCode:string;
  status:string;
  patientCategory:string;
  protocolStatus:string;
  paymentStatus:string;
  nszuStatus:string;
  columns:string[];
};

export type ReportSourceRow = {
  code:string;
  serviceCode:string;
  service:string;
  equipmentId:string;
  desiredDate:string;
  desiredTime:string;
  reportDate:string;
  status:string;
  patientCategory:string;
  referralType:string;
  marketingSource:string;
  durationMinutes:number;
  assignedRadiologistEmail:string;
  assignedRadiographerEmail:string;
  radiologistName:string;
  radiographerName:string;
  performedAt:string;
  anatomicalRegionsCount:number;
  protocolNumber:string;
  protocolStatus:string;
  protocolReadyAt:string;
  protocolIssuedAt:string;
  paymentStatus:string;
  paymentAmount:number;
  paidAmount:number;
  paymentMethod:string;
  nszuStatus:string;
  nszuReference:string;
  externalReference:string;
};

const statusLabels:Record<string,string> = {
  new:"Нова", confirmed:"Підтверджена", rescheduled:"Перенесена",
  completed:"Завершена", cancelled:"Скасована",
};
const categoryLabels:Record<string,string> = {
  military:"Військовий", civilian:"Цивільний",
};
const protocolLabels:Record<string,string> = {
  not_started:"Не розпочато", in_progress:"В роботі", ready:"Готовий", issued:"Видано",
};
const paymentLabels:Record<string,string> = {
  not_set:"Не визначено", pending:"Очікує оплати", paid:"Оплачено",
  not_required:"Не потрібна", refunded:"Повернено",
};
const paymentMethodLabels:Record<string,string> = {
  "":"Не вказано", cash:"Готівка", card:"Картка",
  bank_transfer:"Банківський переказ", privat_link:"Посилання ПриватБанк", other:"Інше",
};
const nszuLabels:Record<string,string> = {
  not_applicable:"Не застосовується", pending:"Очікує перевірки",
  confirmed:"Підтверджено", rejected:"Відхилено",
};

function isValidDate(value:string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validPeriod(from:string,to:string) {
  if (!isValidDate(from) || !isValidDate(to) || from > to) return false;
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1 <= 366;
}

export function readReportFilters(url:URL):ReportFilters | null {
  const today = todayInKyiv();
  const from = url.searchParams.get("from") || `${today.slice(0,7)}-01`;
  const to = url.searchParams.get("to") || today;
  if (!validPeriod(from,to)) return null;
  const template = reportTemplate(url.searchParams.get("template"));
  const columns = selectedReportColumns(template,url.searchParams.get("columns")).map((item)=>item.key);
  const clean = (name:string,max=254) => String(url.searchParams.get(name) || "").trim().slice(0,max);
  return {
    from,
    to,
    template:template.key,
    radiologist:clean("radiologist").toLowerCase(),
    radiographer:clean("radiographer").toLowerCase(),
    equipment:clean("equipment",30),
    serviceCode:clean("serviceCode",20),
    status:clean("status",30),
    patientCategory:clean("patientCategory",30),
    protocolStatus:clean("protocolStatus",30),
    paymentStatus:clean("paymentStatus",30),
    nszuStatus:clean("nszuStatus",30),
    columns,
  };
}

export async function fetchReportSource(db:D1Database,filters:ReportFilters) {
  const reportDate = "COALESCE(NULLIF(substr(b.performed_at, 1, 10), ''), b.desired_date)";
  const where = [`${reportDate} BETWEEN ? AND ?`];
  const values:Array<string> = [filters.from,filters.to];
  const add = (column:string,value:string) => {
    if (!value) return;
    where.push(`${column} = ?`);
    values.push(value);
  };
  add("b.assigned_radiologist_email",filters.radiologist);
  add("b.assigned_radiographer_email",filters.radiographer);
  add("b.equipment_id",filters.equipment);
  add("b.service_code",filters.serviceCode);
  add("b.status",filters.status);
  add("b.patient_category",filters.patientCategory);
  add("b.protocol_status",filters.protocolStatus);
  add("b.payment_status",filters.paymentStatus);
  add("b.nszu_status",filters.nszuStatus);

  const result = await db.prepare(
    `SELECT b.code, b.service_code AS serviceCode, b.service,
      b.equipment_id AS equipmentId, b.desired_date AS desiredDate,
      b.desired_time AS desiredTime, ${reportDate} AS reportDate,
      b.status, b.patient_category AS patientCategory,
      b.referral_type AS referralType, b.marketing_source AS marketingSource,
      b.duration_minutes AS durationMinutes,
      b.assigned_radiologist_email AS assignedRadiologistEmail,
      b.assigned_radiographer_email AS assignedRadiographerEmail,
      COALESCE(NULLIF(rad.display_name,''), b.assigned_radiologist_email, '') AS radiologistName,
      COALESCE(NULLIF(graph.display_name,''), b.assigned_radiographer_email, '') AS radiographerName,
      b.performed_at AS performedAt, b.anatomical_regions_count AS anatomicalRegionsCount,
      b.protocol_number AS protocolNumber, b.protocol_status AS protocolStatus,
      b.protocol_ready_at AS protocolReadyAt, b.protocol_issued_at AS protocolIssuedAt,
      b.payment_status AS paymentStatus, b.payment_amount AS paymentAmount,
      b.paid_amount AS paidAmount, b.payment_method AS paymentMethod,
      b.nszu_status AS nszuStatus, b.nszu_reference AS nszuReference,
      b.external_reference AS externalReference
     FROM bookings b
     LEFT JOIN staff_members rad ON rad.email = b.assigned_radiologist_email
     LEFT JOIN staff_members graph ON graph.email = b.assigned_radiographer_email
     WHERE ${where.join(" AND ")}
     ORDER BY reportDate ASC, b.desired_time ASC LIMIT 5000`
  ).bind(...values).all<ReportSourceRow>();
  return result.results || [];
}

function equipmentName(value:string) {
  return EQUIPMENT[value as keyof typeof EQUIPMENT]?.name || value || "Не вказано";
}

function staffName(row:ReportSourceRow,key:"radiologist"|"radiographer") {
  return key === "radiologist"
    ? row.radiologistName || row.assignedRadiologistEmail || "Не призначено"
    : row.radiographerName || row.assignedRadiographerEmail || "Не призначено";
}

export function buildTemplateRows(template:ReportTemplateKey,source:ReportSourceRow[]):ReportRecord[] {
  if (template === "staff") {
    const grouped = new Map<string,ReportRecord>();
    for (const row of source.filter((item)=>!!item.performedAt && item.status !== "cancelled")) {
      const workers = [
        { email:row.assignedRadiologistEmail, name:staffName(row,"radiologist"), role:"Лікар-рентгенолог" },
        { email:row.assignedRadiographerEmail, name:staffName(row,"radiographer"), role:"Рентгенолаборант" },
      ];
      for (const worker of workers) {
        if (!worker.email) continue;
        const key = `${worker.role}|${worker.email}`;
        const current = grouped.get(key) || {
          employee:worker.name, role:worker.role, studies:0, regions:0, minutes:0,
        };
        current.studies = Number(current.studies) + 1;
        current.regions = Number(current.regions) + Number(row.anatomicalRegionsCount || 1);
        current.minutes = Number(current.minutes) + Number(row.durationMinutes || 0);
        grouped.set(key,current);
      }
    }
    return [...grouped.values()].sort((a,b)=>String(a.role).localeCompare(String(b.role)) || Number(b.studies)-Number(a.studies));
  }

  if (template === "equipment") {
    const grouped = new Map<string,ReportRecord>();
    for (const row of source) {
      const current = grouped.get(row.equipmentId) || {
        equipment:equipmentName(row.equipmentId), studies:0, completed:0, cancelled:0, minutes:0, regions:0,
      };
      if (row.performedAt && row.status !== "cancelled") {
        current.studies = Number(current.studies) + 1;
        current.minutes = Number(current.minutes) + Number(row.durationMinutes || 0);
        current.regions = Number(current.regions) + Number(row.anatomicalRegionsCount || 1);
      }
      if (row.status === "completed") current.completed = Number(current.completed) + 1;
      if (row.status === "cancelled") current.cancelled = Number(current.cancelled) + 1;
      grouped.set(row.equipmentId,current);
    }
    return [...grouped.values()].sort((a,b)=>Number(b.studies)-Number(a.studies));
  }

  if (template === "protocols") {
    return source.map((row)=>({
      code:row.code,
      service:serviceByCode(row.serviceCode)?.title || row.service,
      radiologist:staffName(row,"radiologist"),
      performedAt:row.performedAt || "Не виконано",
      protocolNumber:row.protocolNumber || "Не присвоєно",
      protocolStatus:protocolLabels[row.protocolStatus] || row.protocolStatus,
      protocolReadyAt:row.protocolReadyAt || "",
      protocolIssuedAt:row.protocolIssuedAt || "",
      externalReference:row.externalReference || "",
    }));
  }

  if (template === "finance") {
    return source.map((row)=>({
      date:row.reportDate,
      code:row.code,
      service:serviceByCode(row.serviceCode)?.title || row.service,
      patientCategory:categoryLabels[row.patientCategory] || row.patientCategory,
      dueAmount:Number(row.paymentAmount || 0),
      paidAmount:Number(row.paidAmount || 0),
      paymentStatus:paymentLabels[row.paymentStatus] || row.paymentStatus,
      paymentMethod:paymentMethodLabels[row.paymentMethod] || row.paymentMethod,
      nszuStatus:nszuLabels[row.nszuStatus] || row.nszuStatus,
      nszuReference:row.nszuReference || "",
    }));
  }

  return source.map((row)=>({
    date:row.reportDate,
    code:row.code,
    serviceCode:row.serviceCode,
    service:serviceByCode(row.serviceCode)?.title || row.service,
    equipment:equipmentName(row.equipmentId),
    status:statusLabels[row.status] || row.status,
    patientCategory:categoryLabels[row.patientCategory] || row.patientCategory,
    radiologist:staffName(row,"radiologist"),
    radiographer:staffName(row,"radiographer"),
    performedAt:row.performedAt || "Не виконано",
    regions:Number(row.anatomicalRegionsCount || 1),
    duration:Number(row.durationMinutes || 0),
    externalReference:row.externalReference || "",
  }));
}

export function reportPayload(filters:ReportFilters,source:ReportSourceRow[]) {
  const template = REPORT_TEMPLATES[filters.template];
  const columns = selectedReportColumns(template,filters.columns.join(","));
  const rows = buildTemplateRows(filters.template,source);
  return { template, columns, rows };
}

export function publicFilters(filters:ReportFilters) {
  return {
    from:filters.from, to:filters.to, template:filters.template,
    radiologist:filters.radiologist, radiographer:filters.radiographer,
    equipment:filters.equipment, serviceCode:filters.serviceCode,
    status:filters.status, patientCategory:filters.patientCategory,
    protocolStatus:filters.protocolStatus, paymentStatus:filters.paymentStatus,
    nszuStatus:filters.nszuStatus,
  };
}
