import type { buildRegisterTurnoverReport } from "./register-turnover-report";
import { REGISTER_REPORT_SECTIONS,type RegisterReportSection } from "./saved-report-views";

type Report=Awaited<ReturnType<typeof buildRegisterTurnoverReport>>;
const ALLOWED=new Set<string>(REGISTER_REPORT_SECTIONS);

export function normalizeRegisterReportSections(value:unknown):RegisterReportSection[]{
  const raw=Array.isArray(value)?value:typeof value==="string"?value.split(","):[];
  const sections=[...new Set(raw.map(item=>String(item).trim()).filter(item=>ALLOWED.has(item)))] as RegisterReportSection[];
  return sections.length?sections:[...REGISTER_REPORT_SECTIONS];
}
function safeValue(value:unknown){
  let text=value===null||value===undefined?"":String(value);
  if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
function line(...values:unknown[]){return values.map(safeValue).join(",");}
function section(rows:string[][],title:string,headers:string[],data:Array<Array<unknown>>){
  rows.push([title],headers);for(const item of data)rows.push(item.map(value=>String(value??"")));rows.push([]);
}

export function buildRegisterTurnoverCsv(report:Report,sections:readonly RegisterReportSection[]){
  const enabled=new Set(sections);const rows:string[][]=[];
  rows.push(["RadiologyOS — обороти і залишки"],["Період",report.period.from,report.period.to],["Сформовано",report.generatedAt],[]);
  if(enabled.has("summary"))section(rows,"Підсумок",["Регістр","Збільшення","Зменшення","Нетто","Початкове сальдо","Кінцеве сальдо"],[
    ["Дохід",report.registers.revenue.increase,report.registers.revenue.decrease,report.registers.revenue.net,"",""],
    ["Гроші",report.registers.cash.increase,report.registers.cash.decrease,report.registers.cash.net,"",""],
    ["Взаєморозрахунки",report.registers.settlements.increase,report.registers.settlements.decrease,report.registers.settlements.net,report.registers.settlements.opening,report.registers.settlements.closing],
    ["Послуги",report.registers.services.increase,report.registers.services.decrease,report.registers.services.net,"",""],
    ["Обладнання, хв",report.registers.equipment.increase,report.registers.equipment.decrease,report.registers.equipment.net,"",""],
    ["Виробіток",report.registers.staff.increase,report.registers.staff.decrease,report.registers.staff.net,"",""],
    ["Витрати матеріалів",report.registers.expenses.increase,report.registers.expenses.decrease,report.registers.expenses.net,"",""],
  ]);
  if(enabled.has("revenue"))section(rows,"Дохід за послугами",["Код послуги","Нараховано","Сторновано","Нетто"],report.breakdowns.revenueByService.map(r=>[r.serviceCode,r.accrued,r.reversed,r.net]));
  if(enabled.has("cash"))section(rows,"Гроші за способом оплати",["Спосіб","Надійшло","Повернено","Нетто"],report.breakdowns.cashByMethod.map(r=>[r.method,r.incoming,r.outgoing,r.net]));
  if(enabled.has("expenses"))section(rows,"Витрати матеріалів",["ID","SKU","Матеріал","Од.","Сума","Рухів"],report.breakdowns.expensesByItem.map(r=>[r.itemId,r.sku,r.name,r.unit,r.amount,r.movementCount]));
  if(enabled.has("equipment"))section(rows,"Навантаження обладнання",["Обладнання","Нараховано хв","Сторно хв","Нетто хв"],report.breakdowns.equipment.map(r=>[r.equipmentId,r.loadedMinutes,r.reversedMinutes,r.netMinutes]));
  if(enabled.has("staff"))section(rows,"Виробіток персоналу",["Працівник","Роль","Виконано","Сторно","Нетто"],report.breakdowns.staff.map(r=>[r.memberEmail,r.staffRole,r.performed,r.reversed,r.net]));
  if(enabled.has("inventory"))section(rows,"Склад — загалом",["ID","SKU","Матеріал","Од.","На початок","Надійшло","Вибуло","На кінець"],report.breakdowns.inventory.map(r=>[r.itemId,r.sku,r.name,r.unit,r.opening,r.incoming,r.outgoing,r.closing]));
  if(enabled.has("inventory_by_warehouse"))section(rows,"Склад — по місцях зберігання",["Склад","Код складу","ID","SKU","Матеріал","Од.","На початок","Надійшло","Вибуло","На кінець"],report.breakdowns.inventoryByWarehouse.map(r=>[r.warehouseName,r.warehouseCode,r.itemId,r.sku,r.name,r.unit,r.opening,r.incoming,r.outgoing,r.closing]));
  return "\uFEFF"+rows.map(row=>line(...row)).join("\r\n");
}
