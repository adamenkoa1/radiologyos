import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { canViewReports } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { createSavedRegisterReportView,deleteSavedRegisterReportView,listSavedRegisterReportViews,updateSavedRegisterReportView } from "../../../../../lib/saved-report-views";

function id(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function mapError(error:unknown){
  const code=String(error instanceof Error?error.message:error).toLowerCase();
  if(code.includes("name_invalid"))return Response.json({error:"Назва варіанта має містити 1–80 символів"},{status:400});
  if(code.includes("period_invalid")||code.includes("invalid_report_period")||code.includes("report_period_too_large"))return Response.json({error:"Некоректний період варіанта"},{status:400});
  if(code.includes("sections_invalid")||code.includes("config_invalid"))return Response.json({error:"Некоректні параметри варіанта"},{status:400});
  if(code.includes("unique"))return Response.json({error:"Варіант із такою назвою вже існує"},{status:409});
  return null;
}
async function context(request:Request){
  const db=dbBinding();if(!db)return {response:Response.json({error:"База тимчасово недоступна"},{status:503})} as const;
  const ctx=await requireOrgContext(request,db);if(!ctx)return {response:Response.json({error:"Доступ лише для персоналу"},{status:403})} as const;
  if(!canViewReports(ctx.member.role))return {response:Response.json({error:"Варіанти звітів доступні адміністратору"},{status:403})} as const;
  return {db,ctx} as const;
}
export async function GET(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;
  return Response.json({views:await listSavedRegisterReportViews(db,ctx.organizationId)});
}
export async function POST(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  try{const view=await createSavedRegisterReportView(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,name:body.name,configuration:body.configuration});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"report_view_created",resource:"report_view",targetId:view?.id,details:{reportKey:"register_turnover",sectionCount:view?.configuration.sections.length||0}});
    return Response.json({view},{status:201});
  }catch(error){const mapped=mapError(error);if(mapped)return mapped;throw error;}
}
export async function PATCH(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;const body=await request.json().catch(()=>({})) as Record<string,unknown>;const viewId=id(body.id);if(!viewId)return Response.json({error:"Некоректний варіант"},{status:400});
  try{const view=await updateSavedRegisterReportView(db,{organizationId:ctx.organizationId,id:viewId,actorEmail:ctx.member.email,name:body.name,configuration:body.configuration});if(!view)return Response.json({error:"Варіант не знайдено"},{status:404});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"report_view_updated",resource:"report_view",targetId:view.id,details:{reportKey:"register_turnover",sectionCount:view.configuration.sections.length}});return Response.json({view});
  }catch(error){const mapped=mapError(error);if(mapped)return mapped;throw error;}
}
export async function DELETE(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;const viewId=id(new URL(request.url).searchParams.get("id"));if(!viewId)return Response.json({error:"Некоректний варіант"},{status:400});
  const view=await deleteSavedRegisterReportView(db,ctx.organizationId,viewId);if(!view)return Response.json({error:"Варіант не знайдено"},{status:404});
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"report_view_deleted",resource:"report_view",targetId:view.id,details:{reportKey:"register_turnover"}});return Response.json({ok:true});
}
