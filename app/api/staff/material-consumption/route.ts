import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { createMaterialConsumptionDraft,listMaterialConsumption } from "../../../../lib/material-consumption";
import { requireOrgContext } from "../../../../lib/tenant";

const MANAGER_ROLES=new Set(["admin","radiographer"]);
function id(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function mapError(error:unknown){
  const code=String(error instanceof Error?error.message:error).toLowerCase();
  if(code.includes("reservation_not_found"))return Response.json({error:"Завершену резервацію не знайдено"},{status:404});
  if(code.includes("allocations_required"))return Response.json({error:"Додайте хоча б одну фактичну партію"},{status:400});
  if(code.includes("lot_invalid"))return Response.json({error:"Некоректна партія"},{status:400});
  if(code.includes("quantity_invalid"))return Response.json({error:"Кількість має бути більшою за нуль"},{status:400});
  if(code.includes("overallocated"))return Response.json({error:"Фактична кількість перевищує залишок планової норми"},{status:409});
  if(code.includes("inventory_document_lot_not_found"))return Response.json({error:"Партію не знайдено або матеріал неактивний"},{status:404});
  if(code.includes("inventory_consumption_reservation_invalid"))return Response.json({error:"Партія або резервація не відповідає завершеній послузі"},{status:409});
  return null;
}
async function context(request:Request){
  const db=dbBinding();if(!db)return {response:Response.json({error:"База тимчасово недоступна"},{status:503})} as const;
  const ctx=await requireOrgContext(request,db);if(!ctx)return {response:Response.json({error:"Доступ лише для персоналу"},{status:403})} as const;
  if(!MANAGER_ROLES.has(ctx.role))return {response:Response.json({error:"Фактичне списання матеріалів доступне адміністратору або рентгенолаборанту"},{status:403})} as const;
  return {db,ctx} as const;
}

export async function GET(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  const rows=await listMaterialConsumption(db,ctx.organizationId);
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"material_consumption_queue_viewed",resource:"inventory",details:{rows:rows.length}});
  return Response.json({rows,canManage:true});
}

export async function POST(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;const reservationId=id(body.reservationId);
  if(!reservationId)return Response.json({error:"Некоректна резервація"},{status:400});
  const allocations=Array.isArray(body.allocations)?body.allocations as Array<{lotId?:number;quantity?:number}>:[];
  try{
    const created=await createMaterialConsumptionDraft(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,reservationId,allocations});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"material_consumption_draft_created",resource:"business_document",targetId:created.document.id,details:{reservationId,lineCount:created.lines.length}});
    return Response.json(created,{status:201});
  }catch(error){const mapped=mapError(error);if(mapped)return mapped;throw error;}
}
