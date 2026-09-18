import { audit } from "../../../../lib/audit";
import { createCounterparty,isCounterpartyKind,listCounterparties,updateCounterparty } from "../../../../lib/counterparties";
import { dbBinding } from "../../../../lib/db";
import { requireOrgContext } from "../../../../lib/tenant";

const READ_ROLES=new Set(["admin","registrar","radiographer"]);
const MANAGE_ROLES=new Set(["admin","radiographer"]);
function canRead(role:string){return READ_ROLES.has(role);}
function canManage(role:string){return MANAGE_ROLES.has(role);}
function int(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max);}

function errorResponse(error:unknown){
  const code=String(error instanceof Error?error.message:error).toLowerCase();
  if(code.includes("counterparty_name_required"))return Response.json({error:"Вкажіть назву контрагента"},{status:400});
  if(code.includes("counterparty_email_invalid"))return Response.json({error:"Некоректна e-mail адреса"},{status:400});
  if(code.includes("unique"))return Response.json({error:"Такий код контрагента вже існує"},{status:409});
  return null;
}

export async function GET(request:Request){
  const db=dbBinding();
  if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx||!canRead(ctx.role))return Response.json({error:"Довідник контрагентів доступний уповноваженому персоналу"},{status:403});
  const url=new URL(request.url);
  const rawKind=clean(url.searchParams.get("kind"),30);
  const kind=rawKind==="supplier"?"supplier_or_both":isCounterpartyKind(rawKind)?rawKind:undefined;
  const activeParam=url.searchParams.get("active");
  const active=activeParam==="1"?true:activeParam==="0"?false:undefined;
  const rows=await listCounterparties(db,ctx.organizationId,{kind,active,query:clean(url.searchParams.get("q"),100)});
  return Response.json({counterparties:rows,staff:ctx.member,canManage:canManage(ctx.role)});
}

export async function POST(request:Request){
  const db=dbBinding();
  if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx||!canManage(ctx.role))return Response.json({error:"Контрагентів можуть змінювати адміністратор або рентгенолаборант"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  try{
    const row=await createCounterparty(db,{organizationId:ctx.organizationId,values:body});
    if(!row)return Response.json({error:"Не вдалося створити контрагента"},{status:500});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"counterparty_created",resource:"counterparty",targetId:row.id,details:{kind:row.kind,active:!!row.active,hasCode:!!row.code}});
    return Response.json({counterparty:row},{status:201});
  }catch(error){const mapped=errorResponse(error);if(mapped)return mapped;throw error;}
}

export async function PATCH(request:Request){
  const db=dbBinding();
  if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx||!canManage(ctx.role))return Response.json({error:"Контрагентів можуть змінювати адміністратор або рентгенолаборант"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const id=int(body.id);
  if(!id)return Response.json({error:"Некоректний контрагент"},{status:400});
  try{
    const row=await updateCounterparty(db,{organizationId:ctx.organizationId,id,values:body});
    if(!row)return Response.json({error:"Контрагента не знайдено"},{status:404});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"counterparty_updated",resource:"counterparty",targetId:id,details:{kind:row.kind,active:!!row.active,hasCode:!!row.code}});
    return Response.json({counterparty:row});
  }catch(error){const mapped=errorResponse(error);if(mapped)return mapped;throw error;}
}
