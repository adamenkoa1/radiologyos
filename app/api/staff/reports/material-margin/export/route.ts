import { audit } from "../../../../../../lib/audit";
import { dbBinding } from "../../../../../../lib/db";
import { buildServiceMaterialMarginCsv } from "../../../../../../lib/service-material-margin-csv";
import {
  buildServiceMaterialMarginReport,normalizeServiceMaterialMarginPeriod,
} from "../../../../../../lib/service-material-margin-report";
import { canViewReports } from "../../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../../lib/tenant";

function kyivToday(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function safeFilenameDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:"date";}

export async function GET(request:Request){
  const db=dbBinding();
  if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canViewReports(ctx.member.role))return Response.json({error:"Експорт маржинальності доступний лише адміністратору"},{status:403});

  const today=kyivToday();
  const defaults={from:`${today.slice(0,7)}-01`,to:today};
  try{
    const url=new URL(request.url);
    const period=normalizeServiceMaterialMarginPeriod(url.searchParams.get("from"),url.searchParams.get("to"),defaults);
    const report=await buildServiceMaterialMarginReport(db,ctx.organizationId,period);
    const csv=buildServiceMaterialMarginCsv(report);
    await audit(db,{
      organizationId:ctx.organizationId,
      actorEmail:ctx.member.email,
      action:"report_exported",
      resource:"report",
      targetId:"service_material_margin",
      details:{from:period.from,to:period.to,rows:report.rows.length,scope:report.scope,format:"csv"},
    });
    return new Response(csv,{headers:{
      "content-type":"text/csv; charset=utf-8",
      "content-disposition":`attachment; filename="service-material-margin-${safeFilenameDate(period.from)}-${safeFilenameDate(period.to)}.csv"`,
      "cache-control":"private, no-store",
    }});
  }catch(error){
    if(error instanceof Error&&error.message==="report_period_too_large"){
      return Response.json({error:"Період звіту не може перевищувати 366 днів"},{status:400});
    }
    return Response.json({error:"Некоректний період звіту"},{status:400});
  }
}
