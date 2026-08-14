import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { requireOrgContext } from "../../../../lib/tenant";

const SURFACES = new Set(["studies"]);
const STUDY_STATES = new Set([
  "all","new","requested","needs_verification","scheduled","confirmed","rescheduled",
  "arrived","queued","in_progress","performed","images_ready","reporting","protocol_ready",
  "issued","completed","cancelled","no_show",
]);
const EQUIPMENT = new Set(["all","ct","xray","fluoro"]);

type SavedConfig = { filter:string; equipment:string };

function clean(value:unknown,max:number){return String(value||"").trim().slice(0,max)}
function sanitizeSurface(value:unknown){const v=clean(value,32);return SURFACES.has(v)?v:""}
function sanitizeConfig(surface:string,value:unknown):SavedConfig|null{
  if(surface!=="studies"||!value||typeof value!=="object")return null;
  const raw=value as Record<string,unknown>;
  const filter=clean(raw.filter,40)||"all";
  const equipment=clean(raw.equipment,20)||"all";
  if(!STUDY_STATES.has(filter)||!EQUIPMENT.has(equipment))return null;
  return {filter,equipment};
}

export async function GET(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db); if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const surface=sanitizeSurface(new URL(request.url).searchParams.get("surface"));
  if(!surface)return Response.json({error:"Некоректний розділ"},{status:400});
  const rows=await db.prepare(`SELECT id,name,config_json AS configJson,updated_at AS updatedAt
    FROM staff_saved_views
    WHERE organization_id=? AND member_email=? AND surface=?
    ORDER BY name COLLATE NOCASE,id`).bind(ctx.organizationId,ctx.member.email,surface).all<{id:number;name:string;configJson:string;updatedAt:string}>();
  const views=(rows.results||[]).map(row=>({
    id:row.id,name:row.name,updatedAt:row.updatedAt,
    config:sanitizeConfig(surface,JSON.parse(row.configJson||"{}"))||{filter:"all",equipment:"all"},
  }));
  return Response.json({views},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db); if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const surface=sanitizeSurface(body.surface),name=clean(body.name,48),config=sanitizeConfig(surface,body.config);
  if(!surface||!name||!config)return Response.json({error:"Некоректний варіант списку"},{status:400});
  await db.prepare(`INSERT INTO staff_saved_views (organization_id,member_email,surface,name,config_json)
    VALUES (?,?,?,?,?)
    ON CONFLICT(organization_id,member_email,surface,name)
    DO UPDATE SET config_json=excluded.config_json,updated_at=CURRENT_TIMESTAMP`)
    .bind(ctx.organizationId,ctx.member.email,surface,name,JSON.stringify(config)).run();
  const row=await db.prepare(`SELECT id FROM staff_saved_views WHERE organization_id=? AND member_email=? AND surface=? AND name=? LIMIT 1`)
    .bind(ctx.organizationId,ctx.member.email,surface,name).first<{id:number}>();
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"saved_view_saved",resource:"staff_saved_view",targetId:row?.id||0,details:{surface}});
  return Response.json({ok:true,id:row?.id||0});
}

export async function DELETE(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db); if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const id=Number(body.id),surface=sanitizeSurface(body.surface);
  if(!Number.isInteger(id)||id<1||!surface)return Response.json({error:"Некоректний варіант"},{status:400});
  const result=await db.prepare(`DELETE FROM staff_saved_views WHERE id=? AND organization_id=? AND member_email=? AND surface=?`)
    .bind(id,ctx.organizationId,ctx.member.email,surface).run();
  if(Number(result.meta.changes||0)<1)return Response.json({error:"Варіант не знайдено"},{status:404});
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"saved_view_deleted",resource:"staff_saved_view",targetId:id,details:{surface}});
  return Response.json({ok:true});
}
