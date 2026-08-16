import { dbBinding } from "../../../../lib/db";
import { getBusinessDocumentJournalDetail,listBusinessDocuments } from "../../../../lib/business-document-journal";
import { canManageFinance } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

function int(value:unknown) {
  const n=Number(value);
  return Number.isInteger(n)&&n>0?n:null;
}

export async function GET(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  // This journal exposes patient-level finance/business evidence. Keep it under the same narrow
  // finance capability until subsystem-specific document visibility is introduced.
  if(!canManageFinance(ctx.member.role)) {
    return Response.json({error:"Журнал документів доступний реєстратору або адміністратору"},{status:403});
  }

  const url=new URL(request.url);
  const documentId=int(url.searchParams.get("id"));
  if(documentId) {
    const detail=await getBusinessDocumentJournalDetail(db,ctx.organizationId,documentId);
    if(!detail) return Response.json({error:"Документ не знайдено"},{status:404});
    return Response.json(detail);
  }

  const limit=int(url.searchParams.get("limit")) || 250;
  return Response.json({documents:await listBusinessDocuments(db,ctx.organizationId,limit)});
}
