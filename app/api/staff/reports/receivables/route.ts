import { audit } from "../../../../../../lib/audit";
import { dbBinding } from "../../../../../../lib/db";
import { buildReceivablesReport,normalizeReceivablesAsOf } from "../../../../../../lib/receivables-report";
import { canViewReports } from "../../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../../lib/tenant";

function kyivToday(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

export async function GET(request:Request){
  const db=dbBinding();
  if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canViewReports(ctx.member.role))return Response.json({error:"Дебіторська відомість доступна лише адміністратору"},{status:403});

  try{
    const asOf=normalizeReceivablesAsOf(new URL(request.url).searchParams.get("asOf"),kyivToday());
    const report=await buildReceivablesReport(db,ctx.organizationId,asOf);
    await audit(db,{
      organizationId:ctx.organizationId,
      actorEmail:ctx.member.email,
      action:"report_viewed",
      resource:"report",
      targetId:"receivables",
      details:{asOf,rows:report.debtors.length+report.credits.length,truncated:report.truncated},
    });
    return Response.json(report,{headers:{"cache-control":"no-store"}});
  }catch(error){
    if(error instanceof Error&&error.message==="invalid_receivables_date"){
      return Response.json({error:"Некоректна дата звіту"},{status:400});
    }
    throw error;
  }
}
