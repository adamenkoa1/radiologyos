import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { canAccessBooking, canWriteNotes } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

function clean(value:unknown,max:number){return String(value||"").trim().slice(0,max)}

async function accessible(request:Request,db:D1Database,id:number){
  const ctx=await requireOrgContext(request,db);
  if(!ctx)return null;
  if(!(await canAccessBooking(db,ctx.member,id,ctx.organizationId)))return null;
  return ctx;
}

export async function GET(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const id=Number(new URL(request.url).searchParams.get("id"));
  if(!Number.isInteger(id)||id<1)return Response.json({error:"Некоректне дослідження"},{status:400});
  const ctx=await accessible(request,db,id); if(!ctx)return Response.json({error:"Дослідження не знайдено або не призначено вам"},{status:404});

  const [booking,note,comments,events]=await Promise.all([
    db.prepare(`SELECT id,code,name,service,status,comment,created_at AS createdAt
      FROM bookings WHERE organization_id=? AND id=? LIMIT 1`).bind(ctx.organizationId,id).first(),
    db.prepare(`SELECT note,updated_by AS updatedBy,updated_at AS updatedAt
      FROM booking_staff_notes WHERE booking_id=? LIMIT 1`).bind(id).first(),
    db.prepare(`SELECT c.id,c.body,c.author_email AS authorEmail,
        COALESCE(NULLIF(s.display_name,''),c.author_email) AS authorName,c.created_at AS createdAt
      FROM booking_comments c
      LEFT JOIN staff_members s ON s.email=c.author_email
      WHERE c.organization_id=? AND c.booking_id=? ORDER BY c.id DESC LIMIT 100`)
      .bind(ctx.organizationId,id).all(),
    db.prepare(`SELECT id,action,details,actor,created_at AS createdAt
      FROM booking_events WHERE organization_id=? AND booking_id=? ORDER BY id DESC LIMIT 100`)
      .bind(ctx.organizationId,id).all(),
  ]);

  return Response.json({booking,note:note||null,comments:comments.results,events:events.results,canComment:canWriteNotes(ctx.member.role)},
    {headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const db=dbBinding(); if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const id=Number(body.id),text=clean(body.text,2000);
  if(!Number.isInteger(id)||id<1||!text)return Response.json({error:"Вкажіть коментар"},{status:400});
  const ctx=await accessible(request,db,id); if(!ctx)return Response.json({error:"Дослідження не знайдено або не призначено вам"},{status:404});
  if(!canWriteNotes(ctx.member.role))return Response.json({error:"Недостатньо прав"},{status:403});

  const result=await db.prepare(`INSERT INTO booking_comments (organization_id,booking_id,author_email,body)
    VALUES (?,?,?,?)`).bind(ctx.organizationId,id,ctx.member.email,text).run();
  const commentId=Number(result.meta.last_row_id||0);
  await db.prepare(`INSERT INTO booking_events (organization_id,booking_id,action,details,actor)
    VALUES (?,?,'comment_added','Додано внутрішній коментар',?)`).bind(ctx.organizationId,id,ctx.member.email).run();
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"study_comment_added",resource:"booking",targetId:id,details:{commentId,length:text.length}});
  return Response.json({ok:true,id:commentId},{status:201});
}
