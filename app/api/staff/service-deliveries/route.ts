import { dbBinding } from "../../../../lib/db";
import { canAccessBooking, canManageFinance, canWriteNotes } from "../../../../lib/staff-auth";
import { listServiceDeliveries, postServiceDelivery } from "../../../../lib/service-deliveries";
import { requireOrgContext } from "../../../../lib/tenant";

export async function GET(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canManageFinance(ctx.member.role)) {
    return Response.json({error:"Журнал наданих послуг доступний реєстратору або адміністратору"},{status:403});
  }
  return Response.json({documents:await listServiceDeliveries(db,ctx.organizationId)});
}

export async function POST(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canWriteNotes(ctx.member.role)) return Response.json({error:"Недостатньо прав"},{status:403});

  const body=await request.json().catch(()=>({})) as {bookingId?:number};
  const bookingId=Number(body.bookingId);
  if(!Number.isInteger(bookingId) || bookingId<=0) {
    return Response.json({error:"Некоректна заявка"},{status:400});
  }
  if(!(await canAccessBooking(db,ctx.member,bookingId,ctx.organizationId))) {
    return Response.json({error:"Заявку не знайдено або її не призначено вам"},{status:404});
  }

  try {
    const result=await postServiceDelivery(db,{
      organizationId:ctx.organizationId,
      bookingId,
      actorEmail:ctx.member.email,
    });
    return Response.json({ok:true,...result});
  } catch(error) {
    const code=error instanceof Error ? error.message:String(error);
    if(code==="booking_not_found") return Response.json({error:"Заявку не знайдено"},{status:404});
    if(code==="service_not_performed") {
      return Response.json({error:"Надання послуги можна провести лише після фактичного виконання дослідження"},{status:409});
    }
    if(code==="service_delivery_reversed") {
      return Response.json({error:"Надання послуги вже сторновано. Повторне проведення того самого факту заборонене"},{status:409});
    }
    if(code==="service_delivery_in_progress" || code==="service_delivery_already_exists") {
      return Response.json({error:"Документ надання послуги вже створюється або проведений"},{status:409});
    }
    console.error("service_delivery_post_failed",code);
    return Response.json({error:"Не вдалося провести надання послуги"},{status:500});
  }
}
