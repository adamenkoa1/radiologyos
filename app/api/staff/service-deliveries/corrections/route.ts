import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { listServiceCorrections,postServiceStorno } from "../../../../../lib/service-corrections";
import { canManageFinance } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

function int(value:unknown) {
  const n=Number(value);
  return Number.isInteger(n)&&n>0?n:null;
}

export async function GET(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canManageFinance(ctx.member.role)) {
    return Response.json({error:"Журнал сторно доступний реєстратору або адміністратору"},{status:403});
  }
  return Response.json({documents:await listServiceCorrections(db,ctx.organizationId)});
}

export async function POST(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canManageFinance(ctx.member.role)) {
    return Response.json({error:"Сторнувати надану послугу може реєстратор або адміністратор"},{status:403});
  }

  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const sourceDocumentId=int(body.sourceDocumentId);
  const reason=typeof body.reason==="string"?body.reason.trim().slice(0,500):"";
  if(!sourceDocumentId) return Response.json({error:"Некоректний документ-підстава"},{status:400});
  if(reason.length<5) return Response.json({error:"Вкажіть причину сторно щонайменше 5 символів"},{status:400});

  try {
    const document=await postServiceStorno(db,{
      organizationId:ctx.organizationId,
      sourceDocumentId,
      reason,
      actorEmail:ctx.member.email,
    });
    await audit(db,{
      organizationId:ctx.organizationId,
      actorEmail:ctx.member.email,
      action:document.created?"service_delivery_reversed":"service_delivery_reversal_reused",
      resource:"business_document",
      targetId:sourceDocumentId,
      details:{correctionDocumentId:document.id,correctionNumber:document.number,reason:document.reason},
    });
    return Response.json({ok:true,document},{status:document.created?201:200});
  } catch(error) {
    const code=error instanceof Error?error.message:String(error);
    if(code==="service_delivery_not_found") return Response.json({error:"Документ надання послуги не знайдено"},{status:404});
    if(code==="service_delivery_not_posted") return Response.json({error:"Сторно можливе лише для проведеного надання послуги"},{status:409});
    if(code==="service_delivery_already_reversed") return Response.json({error:"Документ уже сторновано"},{status:409});
    if(code==="service_correction_in_progress") return Response.json({error:"Сторно цього документа вже створюється"},{status:409});
    if(code==="service_correction_reason_required") return Response.json({error:"Вкажіть причину сторно"},{status:400});
    console.error("service_delivery_storno_failed",code);
    return Response.json({error:"Не вдалося провести сторно наданої послуги"},{status:500});
  }
}
