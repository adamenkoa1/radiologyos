import type { buildMaterialConsumptionControlReport } from "./material-consumption-control-report.ts";

type Report=Awaited<ReturnType<typeof buildMaterialConsumptionControlReport>>;

function safeValue(value:unknown){
  if(typeof value==="number"&&Number.isFinite(value))return `"${value}"`;
  let text=value===null||value===undefined?"":String(value);
  if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
function line(...values:unknown[]){return values.map(safeValue).join(",");}

export function buildMaterialConsumptionControlCsv(report:Report){
  const rows:Array<Array<unknown>>=[
    ["RadiologyOS — матеріали: план / факт списання"],
    ["Період виконання послуг",report.period.from,report.period.to],
    ["Стан списань на",report.actualAsOf],
    [],
    ["Підсумок"],
    ["Виконані заявки",report.summary.completedBookings],
    ["Планові позиції",report.summary.reservationFacts],
    ["Повністю списано",report.summary.fullyPosted],
    ["Є draft",report.summary.withDraft],
    ["Потрібне розподілення",report.summary.needsAllocation],
    ["Повністю списано, %",report.summary.fullyPostedPct],
    [],
    ["Код послуги","Послуга","SKU","Матеріал","Од.","Код складу","Склад","Планових позицій","Заявок","План","Факт posted","Draft","Не проведено","Не розподілено","Покриття, %"],
    ...report.rows.map(row=>[
      row.serviceCode,row.serviceTitle,row.itemSku,row.itemName,row.itemUnit,row.warehouseCode,row.warehouseName,
      row.reservationCount,row.bookingCount,row.plannedQuantity,row.postedQuantity,row.draftQuantity,
      row.unpostedQuantity,row.unallocatedQuantity,row.coveragePct,
    ]),
  ];
  return "\uFEFF"+rows.map(row=>line(...row)).join("\r\n");
}
