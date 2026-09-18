import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import {
  createServiceMaterialRequirement,
  deactivateServiceMaterialRequirement,
  listServiceMaterialRequirements,
} from "../../../../lib/service-material-requirements";
import { requireOrgContext } from "../../../../lib/tenant";

function id(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function mapError(error:unknown){
  const code=String(error instanceof Error?error.message:error).toLowerCase();
  if(code.includes("service_material_requirement_service_invalid"))return Response.json({error:"Некоректна послуга"},{status:400});
  if(code.includes("service_material_requirement_item_invalid"))return Response.json({error:"Некоректна номенклатура"},{status:400});
  if(code.includes("service_material_requirement_warehouse_invalid"))return Response.json({error:"Некоректний склад"},{status:400});
  if(code.includes("service_material_requirement_quantity_invalid"))return Response.json({error:"Кількість має бути більшою за нуль"},{status:400});
  if(code.includes("item_tenant_mismatch"))return Response.json({error:"Номенклатура не належить цій організації"},{status:409});
  if(code.includes("warehouse_tenant_mismatch"))return Response.json({error:"Склад не належить цій організації"},{status:409});
  if(code.includes("reference_inactive"))return Response.json({error:"Номенклатура і склад мають бути активними"},{status:409});
  if(code.includes("unique"))return Response.json({error:"Активна норма для цієї послуги, номенклатури та складу вже існує"},{status:409});
  return null;
}
async function context(request:Request){
  const db=dbBinding();if(!db)return {response:Response.json({error:"База тимчасово недоступна"},{status:503})} as const;
  const ctx=await requireOrgContext(request,db);if(!ctx)return {response:Response.json({error:"Доступ лише для персоналу"},{status:403})} as const;
  return {db,ctx} as const;
}

export async function GET(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  const params=new URL(request.url).searchParams;
  const activeParam=params.get("active");const active=activeParam==="1"?true:activeParam==="0"?false:undefined;
  const serviceCode=params.get("serviceCode")?.trim()||undefined;
  const requirements=await listServiceMaterialRequirements(db,ctx.organizationId,{active,serviceCode});
  return Response.json({requirements,canEdit:ctx.role==="admin"});
}

export async function POST(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  if(ctx.role!=="admin")return Response.json({error:"Норми матеріалів може змінювати лише адміністратор"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  try{
    const requirement=await createServiceMaterialRequirement(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,values:body});
    if(!requirement)return Response.json({error:"Не вдалося створити норму"},{status:500});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"service_material_requirement_created",resource:"service_material_requirement",targetId:requirement.id,details:{serviceCode:requirement.serviceCode,itemId:requirement.itemId,warehouseId:requirement.warehouseId,quantity:requirement.quantity}});
    return Response.json({requirement},{status:201});
  }catch(error){const mapped=mapError(error);if(mapped)return mapped;throw error;}
}

export async function PATCH(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  if(ctx.role!=="admin")return Response.json({error:"Норми матеріалів може змінювати лише адміністратор"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;const requirementId=id(body.id);
  if(!requirementId)return Response.json({error:"Некоректна норма"},{status:400});
  const requirement=await deactivateServiceMaterialRequirement(db,{organizationId:ctx.organizationId,id:requirementId,actorEmail:ctx.member.email});
  if(!requirement)return Response.json({error:"Норму не знайдено"},{status:404});
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"service_material_requirement_deactivated",resource:"service_material_requirement",targetId:requirement.id,details:{serviceCode:requirement.serviceCode,itemId:requirement.itemId,warehouseId:requirement.warehouseId}});
  return Response.json({requirement});
}
