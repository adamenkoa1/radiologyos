export type RegisterReportPeriodPreset="current_month"|"last_30_days"|"custom";
export type RegisterReportSection="summary"|"revenue"|"cash"|"expenses"|"equipment"|"staff"|"inventory"|"inventory_by_warehouse";

export const REGISTER_REPORT_UI_SECTIONS:ReadonlyArray<{key:RegisterReportSection;label:string}>=[
  {key:"summary",label:"Підсумок"},
  {key:"revenue",label:"Дохід"},
  {key:"cash",label:"Гроші"},
  {key:"expenses",label:"Витрати матеріалів"},
  {key:"equipment",label:"Обладнання"},
  {key:"staff",label:"Персонал"},
  {key:"inventory",label:"Склад — загалом"},
  {key:"inventory_by_warehouse",label:"Склад — по місцях"},
];

function daysBefore(date:string,days:number){
  const value=new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate()-days);
  return value.toISOString().slice(0,10);
}

export function resolveRegisterReportPeriod(
  preset:RegisterReportPeriodPreset,
  today:string,
  customFrom:string,
  customTo:string,
){
  if(preset==="current_month")return {from:`${today.slice(0,7)}-01`,to:today};
  if(preset==="last_30_days")return {from:daysBefore(today,29),to:today};
  return {from:customFrom,to:customTo};
}
