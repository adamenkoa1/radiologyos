import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { EQUIPMENT_REGISTRY_KEY, parseEquipmentRegistry } from "../../../../lib/equipment-registry";
import { getSetting } from "../../../../lib/settings";
import { requireOrgContext } from "../../../../lib/tenant";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(["fault","repair","maintenance","inspection","calibration"]);
const STATUSES = new Set(["open","in_progress","done","cancelled"]);
const MANAGER_ROLES = new Set(["admin","radiographer"]);

function clean(value:unknown,max:number){return String(value||"").trim().slice(0,max)}
function registryKey(organizationId:number){return organizationId===1?EQUIPMENT_REGISTRY_KEY:`org:${organizationId}:${EQUIPMENT_REGISTRY_KEY}`}
function canManage(role:string){return MANAGER_ROLES.has(role)}

async function equipmentExists(db:D1Database,organizationId:number,equipmentId:string){
  const rows=parseEquipmentRegistry(await getSetting(db,registryKey(organizationId)));
  return rows.find(row=>row.id===equipmentId)||null;
}
async function activeMember(db:D1Database,organizationId:number,email:string){
  if(!email)return true;
  const row=await db.prepare(`SELECT 1 AS ok FROM memberships m JOIN staff_members s ON s.email=m.member_email WHERE m.organization_id=? AND m.member_email=? AND m.active=1 AND s.active=1 LIMIT 1`).bind(organizationId,email).first<{ok:number}>();
  return !!row?.ok;
}

export async function GET(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db); if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const equipment=parseEquipmentRegistry(await getSetting(db,registryKey(ctx.organizationId)));
  const rows=await db.prepare(`SELECT id,equipment_id AS equipmentId,event_type AS eventType,status,title,details,vendor,assigned_email AS assignedEmail,due_date AS dueDate,downtime_start AS downtimeStart,downtime_end AS downtimeEnd,created_by AS createdBy,completed_by AS completedBy,completed_at AS completedAt,created_at AS createdAt,updated_at AS updatedAt FROM equipment_maintenance WHERE organization_id=? ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, CASE WHEN due_date='' THEN 1 ELSE 0 END,due_date,id DESC LIMIT 500`).bind(ctx.organizationId).all();
  const members=await db.prepare(`SELECT s.email,s.display_name AS displayName,m.role FROM memberships m JOIN staff_members s ON s.email=m.member_email WHERE m.organization_id=? AND m.active=1 AND s.active=1 ORDER BY s.display_name,s.email`).bind(ctx.organizationId).all();
  return Response.json({events:rows.results,equipment,members:members.results,staff:{...ctx.member,role:ctx.role},canManage:canManage(ctx.role)},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db); if(!ctx||!canManage(ctx.role))return Response.json({error:"Журнал ТО можуть змінювати адміністратор або рентгенолаборант"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const equipmentId=clean(body.equipmentId,80), eventType=TYPES.has(String(body.eventType))?String(body.eventType):"fault", title=clean(body.title,180), details=clean(body.details,4000), vendor=clean(body.vendor,180), assignedEmail=clean(body.assignedEmail,254).toLowerCase(), dueDate=clean(body.dueDate,10), downtimeStart=clean(body.downtimeStart,10);
  if(!equipmentId||!title)return Response.json({error:"Вкажіть обладнання і короткий опис"},{status:400});
  if(dueDate&&!DATE_RE.test(dueDate))return Response.json({error:"Некоректний строк"},{status:400});
  if(downtimeStart&&!DATE_RE.test(downtimeStart))return Response.json({error:"Некоректна дата початку простою"},{status:400});
  if(!(await equipmentExists(db,ctx.organizationId,equipmentId)))return Response.json({error:"Обладнання не належить до цієї організації"},{status:400});
  if(!(await activeMember(db,ctx.organizationId,assignedEmail)))return Response.json({error:"Відповідальний не належить до цієї організації"},{status:400});
  const result=await db.prepare(`INSERT INTO equipment_maintenance (organization_id,equipment_id,event_type,status,title,details,vendor,assigned_email,due_date,downtime_start,created_by) VALUES (?,?,?,'open',?,?,?,?,?,?,?)`).bind(ctx.organizationId,equipmentId,eventType,title,details,vendor,assignedEmail,dueDate,downtimeStart,ctx.member.email).run();
  const id=Number(result.meta.last_row_id||0);
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"equipment_maintenance_created",resource:"equipment_maintenance",targetId:id,details:{equipmentId,eventType,hasDowntime:!!downtimeStart}});
  return Response.json({ok:true,id},{status:201});
}

export async function PATCH(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db); if(!ctx||!canManage(ctx.role))return Response.json({error:"Журнал ТО можуть змінювати адміністратор або рентгенолаборант"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>; const id=Number(body.id);
  if(!Number.isInteger(id)||id<1)return Response.json({error:"Некоректний запис"},{status:400});
  const existing=await db.prepare(`SELECT id,status,assigned_email AS assignedEmail,due_date AS dueDate,downtime_start AS downtimeStart,downtime_end AS downtimeEnd FROM equipment_maintenance WHERE organization_id=? AND id=? LIMIT 1`).bind(ctx.organizationId,id).first<{id:number;status:string;assignedEmail:string;dueDate:string;downtimeStart:string;downtimeEnd:string}>();
  if(!existing)return Response.json({error:"Запис не знайдено"},{status:404});
  const status=body.status===undefined?existing.status:String(body.status); if(!STATUSES.has(status))return Response.json({error:"Некоректний статус"},{status:400});
  const assignedEmail=body.assignedEmail===undefined?existing.assignedEmail:clean(body.assignedEmail,254).toLowerCase();
  const dueDate=body.dueDate===undefined?existing.dueDate:clean(body.dueDate,10); const downtimeEnd=body.downtimeEnd===undefined?existing.downtimeEnd:clean(body.downtimeEnd,10);
  if(dueDate&&!DATE_RE.test(dueDate))return Response.json({error:"Некоректний строк"},{status:400});
  if(downtimeEnd&&!DATE_RE.test(downtimeEnd))return Response.json({error:"Некоректна дата завершення простою"},{status:400});
  if(existing.downtimeStart&&downtimeEnd&&downtimeEnd<existing.downtimeStart)return Response.json({error:"Кінець простою не може бути раніше початку"},{status:400});
  if(!(await activeMember(db,ctx.organizationId,assignedEmail)))return Response.json({error:"Відповідальний не належить до цієї організації"},{status:400});
  await db.prepare(`UPDATE equipment_maintenance SET status=?,assigned_email=?,due_date=?,downtime_end=?,completed_by=CASE WHEN ?='done' THEN ? ELSE '' END,completed_at=CASE WHEN ?='done' THEN CURRENT_TIMESTAMP ELSE '' END,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=?`).bind(status,assignedEmail,dueDate,downtimeEnd,status,ctx.member.email,status,ctx.organizationId,id).run();
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:status==="done"&&existing.status!=="done"?"equipment_maintenance_completed":"equipment_maintenance_updated",resource:"equipment_maintenance",targetId:id,details:{status}});
  return Response.json({ok:true});
}
