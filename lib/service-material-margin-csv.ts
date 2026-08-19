import type { buildServiceMaterialMarginReport } from "./service-material-margin-report.ts";

type Report=Awaited<ReturnType<typeof buildServiceMaterialMarginReport>>;

function safeValue(value:unknown){
  let text=value===null||value===undefined?"":String(value);
  if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
function line(...values:unknown[]){return values.map(safeValue).join(",");}

export function buildServiceMaterialMarginCsv(report:Report){
  const rows:Array<Array<unknown>>=[
    ["RadiologyOS — маржинальність послуг: матеріали"],
    ["Період",report.period.from,report.period.to],
    ["Сформовано",report.generatedAt],
    [],
    ["Підсумок"],
    ["Чистий дохід",report.summary.netRevenue],
    ["Матеріали, прив’язані до заявок",report.summary.linkedMaterialCost],
    ["Неприв’язані списання",report.summary.unlinkedMaterialCost],
    ["Матеріальний внесок",report.summary.contribution],
    ["Матеріальна маржа, %",report.summary.marginPct??""],
    [],
    ["Код послуги","Послуга","Виконано, нетто","Заявок з доходом","Заявок з матеріалами","Чистий дохід","Матеріали","Матеріальний внесок","Маржа, %"],
    ...report.rows.map(row=>[
      row.serviceCode,row.serviceTitle,row.performedNet,row.revenueBookings,row.costBookings,
      row.netRevenue,row.materialCost,row.contribution,row.marginPct??"",
    ]),
  ];
  return "\uFEFF"+rows.map(row=>line(...row)).join("\r\n");
}
