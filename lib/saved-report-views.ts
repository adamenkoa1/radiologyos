import { normalizeRegisterPeriod } from "./register-turnover-report";

export const REGISTER_REPORT_SECTIONS=["summary","revenue","cash","expenses","equipment","staff","inventory","inventory_by_warehouse"] as const;
export type RegisterReportSection=typeof REGISTER_REPORT_SECTIONS[number];
export type RegisterReportPeriodPreset="current_month"|"last_30_days"|"custom";
export type SavedRegisterReportConfig={periodPreset:RegisterReportPeriodPreset;from:string;to:string;sections:RegisterReportSection[]};
export type SavedReportView={id:number;organizationId:number;reportKey:"register_turnover";name:string;configuration:SavedRegisterReportConfig;createdBy:string;createdAt:string;updatedBy:string;updatedAt:string};

type Row={id:number;organizationId:number;reportKey:"register_turnover";name:string;configurationJson:string;createdBy:string;createdAt:string;updatedBy:string;updatedAt:string};
const ALL=new Set<string>(REGISTER_REPORT_SECTIONS);

function cleanName(value:unknown){const name=String(value??"").trim();if(!name||name.length>80)throw new Error("saved_report_view_name_invalid");return name;}
function preset(value:unknown):RegisterReportPeriodPreset{if(value==="current_month"||value==="last_30_days"||value==="custom")return value;throw new Error("saved_report_view_period_invalid");}
export function normalizeSavedRegisterReportConfig(value:unknown):SavedRegisterReportConfig{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("saved_report_view_config_invalid");
  const raw=value as Record<string,unknown>;const periodPreset=preset(raw.periodPreset);
  let from="",to="";
  if(periodPreset==="custom"){const period=normalizeRegisterPeriod(raw.from,raw.to);from=period.from;to=period.to;}
  const requested=Array.isArray(raw.sections)?raw.sections:REGISTER_REPORT_SECTIONS;
  const sections=[...new Set(requested.map(String).filter(section=>ALL.has(section)))] as RegisterReportSection[];
  if(!sections.length)throw new Error("saved_report_view_sections_invalid");
  return {periodPreset,from,to,sections};
}
function hydrate(row:Row):SavedReportView{
  let parsed:unknown;try{parsed=JSON.parse(row.configurationJson);}catch{throw new Error("saved_report_view_corrupt");}
  return {...row,configuration:normalizeSavedRegisterReportConfig(parsed)};
}
const SELECT=`SELECT id,organization_id AS organizationId,report_key AS reportKey,name,configuration_json AS configurationJson,created_by AS createdBy,created_at AS createdAt,updated_by AS updatedBy,updated_at AS updatedAt FROM saved_report_views`;

export async function listSavedRegisterReportViews(db:D1Database,organizationId:number){
  const rows=await db.prepare(`${SELECT} WHERE organization_id=? AND report_key='register_turnover' ORDER BY updated_at DESC,id DESC`).bind(organizationId).all<Row>();
  return rows.results.map(hydrate);
}
export async function getSavedRegisterReportView(db:D1Database,organizationId:number,id:number){
  const row=await db.prepare(`${SELECT} WHERE organization_id=? AND report_key='register_turnover' AND id=? LIMIT 1`).bind(organizationId,id).first<Row>();
  return row?hydrate(row):null;
}
export async function createSavedRegisterReportView(db:D1Database,input:{organizationId:number;actorEmail:string;name:unknown;configuration:unknown}){
  const name=cleanName(input.name),configuration=normalizeSavedRegisterReportConfig(input.configuration),actor=String(input.actorEmail||"").trim();
  if(!actor)throw new Error("saved_report_view_actor_required");
  const json=JSON.stringify(configuration);if(json.length>2048)throw new Error("saved_report_view_config_invalid");
  const result=await db.prepare(`INSERT INTO saved_report_views (organization_id,report_key,name,configuration_json,created_by,updated_by) VALUES (?,'register_turnover',?,?,?,?)`).bind(input.organizationId,name,json,actor,actor).run();
  const id=Number(result.meta.last_row_id||0);if(!id)throw new Error("saved_report_view_create_failed");
  return getSavedRegisterReportView(db,input.organizationId,id);
}
export async function updateSavedRegisterReportView(db:D1Database,input:{organizationId:number;id:number;actorEmail:string;name:unknown;configuration:unknown}){
  const name=cleanName(input.name),configuration=normalizeSavedRegisterReportConfig(input.configuration),actor=String(input.actorEmail||"").trim();
  if(!actor)throw new Error("saved_report_view_actor_required");
  const json=JSON.stringify(configuration);if(json.length>2048)throw new Error("saved_report_view_config_invalid");
  await db.prepare(`UPDATE saved_report_views SET name=?,configuration_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND report_key='register_turnover' AND id=?`).bind(name,json,actor,input.organizationId,input.id).run();
  return getSavedRegisterReportView(db,input.organizationId,input.id);
}
export async function deleteSavedRegisterReportView(db:D1Database,organizationId:number,id:number){
  const current=await getSavedRegisterReportView(db,organizationId,id);if(!current)return null;
  await db.prepare(`DELETE FROM saved_report_views WHERE organization_id=? AND report_key='register_turnover' AND id=?`).bind(organizationId,id).run();
  return current;
}
