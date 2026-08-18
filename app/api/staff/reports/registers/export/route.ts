import { audit } from "../../../../../../lib/audit";
import { dbBinding } from "../../../../../../lib/db";
import { buildRegisterTurnoverCsv,normalizeRegisterReportSections } from "../../../../../../lib/register-turnover-csv";
import { buildRegisterTurnoverReport,normalizeRegisterPeriod } from "../../../../../../lib/register-turnover-report";
import { canViewReports } from "../../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../../lib/tenant";

function kyivToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function safeFilenameDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:"date";}

export async function GET(request:Request){
  const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canViewReports(ctx.member.role))return Response.json({error:"Експорт звітів доступний адміністратору"},{status:403});
  const url=new URL(request.url),today=kyivToday(),defaultFrom=`${today.slice(0,7)}-01`;
  try{
    const period=normalizeRegisterPeriod(url.searchParams.get("from")||defaultFrom,url.searchParams.get("to")||today);
    const sections=normalizeRegisterReportSections(url.searchParams.get("sections")||"");
    const report=await buildRegisterTurnoverReport(db,ctx.organizationId,period);
    const csv=buildRegisterTurnoverCsv(report,sections);
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"register_report_exported",resource:"report",details:{reportKey:"register_turnover",from:period.from,to:period.to,format:"csv",sectionCount:sections.length}});
    return new Response(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="register-turnover-${safeFilenameDate(period.from)}-${safeFilenameDate(period.to)}.csv"`,`cache-control`:"private, no-store"}});
  }catch(error){
    const code=error instanceof Error?error.message:String(error);
    if(code==="report_period_too_large")return Response.json({error:"Період звіту не може перевищувати 366 днів"},{status:400});
    return Response.json({error:"Некоректні параметри звіту"},{status:400});
  }
}
