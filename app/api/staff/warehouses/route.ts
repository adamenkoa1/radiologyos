import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { createWarehouse,listWarehouses,updateWarehouse } from "../../../../lib/warehouses";
import { requireOrgContext } from "../../../../lib/tenant";

function id(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function mapError(error:unknown){
  const code=String(error instanceof Error?error.message:error).toLowerCase();
  if(code.includes("warehouse_name_required"))return Response.json({error:"Вкажіть назву складу"},{status:400});
  if(code.includes("warehouse_default_must_be_active"))return Response.json({error:"Основний склад має бути активним"},{status:409});
  if(code.includes("warehouse_default_replacement_required"))return Response.json({error:"Спочатку створіть інший активний склад і зробіть його основним"},{status:409});
  if(code.includes("unique"))return Response.json({error:"Такий код складу вже існує"},{status:409});
  return null;
}
async function context(request:Request){
  const db=dbBinding();if(!db)return {response:Response.json({error:"База тимчасово недоступна"},{status:503})} as const;
  const ctx=await requireOrgContext(request,db);if(!ctx)return {response:Response.json({error:"Доступ лише для персоналу"},{status:403})} as const;
  return {db,ctx} as const;
}
export async function GET(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  const activeParam=new URL(request.url).searchParams.get("active");const active=activeParam==="1"?true:activeParam==="0"?false:undefined;
  const warehouses=await listWarehouses(db,ctx.organizationId,{active});
  return Response.json({warehouses,staff:ctx.member,canEdit:ctx.role==="admin"});
}
export async function POST(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  if(ctx.role!=="admin")return Response.json({error:"Довідник складів може змінювати лише адміністратор"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  try{
    const warehouse=await createWarehouse(db,{organizationId:ctx.organizationId,values:body});
    if(!warehouse)return Response.json({error:"Не вдалося створити склад"},{status:500});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"warehouse_created",resource:"warehouse",targetId:warehouse.id,details:{active:!!warehouse.active,isDefault:!!warehouse.isDefault,hasCode:!!warehouse.code}});
    return Response.json({warehouse},{status:201});
  }catch(error){const mapped=mapError(error);if(mapped)return mapped;throw error;}
}
export async function PATCH(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  if(ctx.role!=="admin")return Response.json({error:"Довідник складів може змінювати лише адміністратор"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;const warehouseId=id(body.id);
  if(!warehouseId)return Response.json({error:"Некоректний склад"},{status:400});
  try{
    const warehouse=await updateWarehouse(db,{organizationId:ctx.organizationId,id:warehouseId,values:body});
    if(!warehouse)return Response.json({error:"Склад не знайдено"},{status:404});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"warehouse_updated",resource:"warehouse",targetId:warehouse.id,details:{active:!!warehouse.active,isDefault:!!warehouse.isDefault,hasCode:!!warehouse.code}});
    return Response.json({warehouse});
  }catch(error){const mapped=mapError(error);if(mapped)return mapped;throw error;}
}
