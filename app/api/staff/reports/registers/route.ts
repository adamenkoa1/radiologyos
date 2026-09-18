import { dbBinding } from "../../../../../lib/db";
import { buildRegisterTurnoverReport,normalizeRegisterPeriod } from "../../../../../lib/register-turnover-report";
import { canViewReports } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

function kyivToday() {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

export async function GET(request:Request) {
  const db=dbBinding();
  if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canViewReports(ctx.member.role))return Response.json({error:"Обороти регістрів доступні адміністратору"},{status:403});

  const url=new URL(request.url);
  const today=kyivToday();
  const defaultFrom=`${today.slice(0,7)}-01`;
  try{
    const period=normalizeRegisterPeriod(url.searchParams.get("from")||defaultFrom,url.searchParams.get("to")||today);
    return Response.json(await buildRegisterTurnoverReport(db,ctx.organizationId,period));
  }catch(error){
    const code=error instanceof Error?error.message:String(error);
    if(code==="report_period_too_large")return Response.json({error:"Період звіту не може перевищувати 366 днів"},{status:400});
    return Response.json({error:"Некоректний період звіту"},{status:400});
  }
}
