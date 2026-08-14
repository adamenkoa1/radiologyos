import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { canAccessBooking, canWriteNotes } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

const FIELD_TYPES = new Set(["text", "number", "date", "boolean", "select"]);

type DefinitionRow = {
  id:number; label:string; fieldType:string; optionsJson:string; required:number; active:number; sortOrder:number;
};

function clean(value:unknown,max:number){return String(value ?? "").trim().slice(0,max)}

function cleanOptions(value:unknown){
  if(!Array.isArray(value))return [] as string[];
  const out:string[]=[];
  for(const item of value){
    const option=clean(item,80);
    if(option && !out.includes(option))out.push(option);
    if(out.length>=20)break;
  }
  return out;
}

function parseOptions(raw:string){
  try{
    const parsed=JSON.parse(raw);
    return Array.isArray(parsed)?parsed.filter((v):v is string=>typeof v==="string").slice(0,20):[];
  }catch{return [] as string[];}
}

function normalizeValue(def:{fieldType:string;optionsJson:string;required:number},raw:unknown){
  const empty=raw === null || raw === undefined || String(raw).trim() === "";
  if(empty){
    if(def.required)return {error:"Поле є обов’язковим"} as const;
    return {value:"",remove:true} as const;
  }
  if(def.fieldType==="text")return {value:clean(raw,500),remove:false} as const;
  if(def.fieldType==="number"){
    const text=String(raw).trim().replace(",", ".");
    const number=Number(text);
    if(!Number.isFinite(number))return {error:"Вкажіть число"} as const;
    return {value:String(number),remove:false} as const;
  }
  if(def.fieldType==="date"){
    const text=String(raw).trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)))return {error:"Некоректна дата"} as const;
    return {value:text,remove:false} as const;
  }
  if(def.fieldType==="boolean"){
    if(raw===true || raw===1 || raw==="1" || raw==="true")return {value:"1",remove:false} as const;
    if(raw===false || raw===0 || raw==="0" || raw==="false")return {value:"0",remove:false} as const;
    return {error:"Некоректне значення так/ні"} as const;
  }
  if(def.fieldType==="select"){
    const text=clean(raw,80);
    if(!parseOptions(def.optionsJson).includes(text))return {error:"Оберіть значення зі списку"} as const;
    return {value:text,remove:false} as const;
  }
  return {error:"Непідтримуваний тип поля"} as const;
}

async function context(request:Request,db:D1Database){
  const ctx=await requireOrgContext(request,db);
  if(!ctx)return null;
  return ctx;
}

export async function GET(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await context(request,db); if(!ctx)return Response.json({error:"Потрібна авторизація"},{status:401});
  const bookingId=Number(new URL(request.url).searchParams.get("bookingId")||0);

  if(!bookingId){
    if(ctx.member.role!=="admin")return Response.json({error:"Недостатньо прав"},{status:403});
    const rows=await db.prepare(`SELECT id,label,field_type AS fieldType,options_json AS optionsJson,
      required,active,sort_order AS sortOrder FROM custom_field_definitions
      WHERE organization_id=? AND entity_type='booking' ORDER BY sort_order,id`)
      .bind(ctx.organizationId).all<DefinitionRow>();
    return Response.json({definitions:(rows.results||[]).map(row=>({...row,options:parseOptions(row.optionsJson)})),canManage:true},
      {headers:{"cache-control":"no-store"}});
  }

  if(!Number.isInteger(bookingId)||bookingId<1 || !(await canAccessBooking(db,ctx.member,bookingId,ctx.organizationId)))
    return Response.json({error:"Дослідження не знайдено або не призначено вам"},{status:404});

  const rows=await db.prepare(`SELECT d.id,d.label,d.field_type AS fieldType,d.options_json AS optionsJson,
      d.required,d.active,d.sort_order AS sortOrder,COALESCE(v.value_text,'') AS value
    FROM custom_field_definitions d
    LEFT JOIN custom_field_values v ON v.organization_id=d.organization_id AND v.definition_id=d.id
      AND v.entity_type='booking' AND v.entity_id=?
    WHERE d.organization_id=? AND d.entity_type='booking' AND d.active=1
    ORDER BY d.sort_order,d.id`)
    .bind(bookingId,ctx.organizationId).all<DefinitionRow & {value:string}>();
  return Response.json({
    definitions:(rows.results||[]).map(row=>({...row,options:parseOptions(row.optionsJson)})),
    canWrite:canWriteNotes(ctx.member.role),canManage:ctx.member.role==="admin",
  },{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await context(request,db); if(!ctx)return Response.json({error:"Потрібна авторизація"},{status:401});
  if(ctx.member.role!=="admin")return Response.json({error:"Недостатньо прав"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const label=clean(body.label,120),fieldType=clean(body.fieldType,20),required=body.required?1:0;
  const sortOrder=Math.max(-1000,Math.min(1000,Number(body.sortOrder)||0));
  if(!label)return Response.json({error:"Вкажіть назву поля"},{status:400});
  if(!FIELD_TYPES.has(fieldType))return Response.json({error:"Некоректний тип поля"},{status:400});
  const options=fieldType==="select"?cleanOptions(body.options):[];
  if(fieldType==="select" && options.length<1)return Response.json({error:"Додайте хоча б один варіант"},{status:400});
  const result=await db.prepare(`INSERT INTO custom_field_definitions
    (organization_id,entity_type,label,field_type,options_json,required,active,sort_order,created_by)
    VALUES (?,'booking',?,?,?,?,1,?,?)`)
    .bind(ctx.organizationId,label,fieldType,JSON.stringify(options),required,sortOrder,ctx.member.email).run();
  const id=Number(result.meta.last_row_id||0);
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"custom_field_created",resource:"custom_field_definition",targetId:id,details:{fieldType,required:Boolean(required)}});
  return Response.json({ok:true,id},{status:201});
}

export async function PATCH(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await context(request,db); if(!ctx)return Response.json({error:"Потрібна авторизація"},{status:401});
  if(ctx.member.role!=="admin")return Response.json({error:"Недостатньо прав"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const id=Number(body.id),label=clean(body.label,120),required=body.required?1:0,active=body.active===false?0:1;
  const sortOrder=Math.max(-1000,Math.min(1000,Number(body.sortOrder)||0));
  if(!Number.isInteger(id)||id<1||!label)return Response.json({error:"Некоректні дані"},{status:400});
  const existing=await db.prepare(`SELECT field_type AS fieldType FROM custom_field_definitions WHERE organization_id=? AND id=? AND entity_type='booking' LIMIT 1`)
    .bind(ctx.organizationId,id).first<{fieldType:string}>();
  if(!existing)return Response.json({error:"Поле не знайдено"},{status:404});
  const options=existing.fieldType==="select"?cleanOptions(body.options):[];
  if(existing.fieldType==="select" && options.length<1)return Response.json({error:"Додайте хоча б один варіант"},{status:400});
  await db.prepare(`UPDATE custom_field_definitions SET label=?,options_json=?,required=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP
    WHERE organization_id=? AND id=? AND entity_type='booking'`)
    .bind(label,JSON.stringify(options),required,active,sortOrder,ctx.organizationId,id).run();
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"custom_field_updated",resource:"custom_field_definition",targetId:id,details:{active:Boolean(active),required:Boolean(required)}});
  return Response.json({ok:true});
}

export async function PUT(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await context(request,db); if(!ctx)return Response.json({error:"Потрібна авторизація"},{status:401});
  if(!canWriteNotes(ctx.member.role))return Response.json({error:"Недостатньо прав"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const bookingId=Number(body.bookingId),fieldId=Number(body.fieldId);
  if(!Number.isInteger(bookingId)||bookingId<1||!Number.isInteger(fieldId)||fieldId<1)
    return Response.json({error:"Некоректні дані"},{status:400});
  if(!(await canAccessBooking(db,ctx.member,bookingId,ctx.organizationId)))
    return Response.json({error:"Дослідження не знайдено або не призначено вам"},{status:404});
  const def=await db.prepare(`SELECT field_type AS fieldType,options_json AS optionsJson,required
    FROM custom_field_definitions WHERE organization_id=? AND id=? AND entity_type='booking' AND active=1 LIMIT 1`)
    .bind(ctx.organizationId,fieldId).first<{fieldType:string;optionsJson:string;required:number}>();
  if(!def)return Response.json({error:"Поле не знайдено"},{status:404});
  const normalized=normalizeValue(def,body.value);
  if("error" in normalized)return Response.json({error:normalized.error},{status:400});
  if(normalized.remove){
    await db.prepare(`DELETE FROM custom_field_values WHERE organization_id=? AND definition_id=? AND entity_type='booking' AND entity_id=?`)
      .bind(ctx.organizationId,fieldId,bookingId).run();
  }else{
    await db.prepare(`INSERT INTO custom_field_values
      (organization_id,definition_id,entity_type,entity_id,value_text,updated_by)
      VALUES (?,?,'booking',?,?,?)
      ON CONFLICT(organization_id,definition_id,entity_type,entity_id)
      DO UPDATE SET value_text=excluded.value_text,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
      .bind(ctx.organizationId,fieldId,bookingId,normalized.value,ctx.member.email).run();
  }
  await db.prepare(`INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
    VALUES (?,?,'custom_field_updated','Оновлено додатковий реквізит',?)`)
    .bind(ctx.organizationId,bookingId,ctx.member.email).run();
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"custom_field_value_updated",resource:"booking",targetId:bookingId,details:{fieldId,cleared:normalized.remove}});
  return Response.json({ok:true});
}
