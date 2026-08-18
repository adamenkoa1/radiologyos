import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { canAccessBooking, canDeliverResults } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

const ADDENDUM_ID_RE = /^[0-9a-f]{32}$/;
type DeliveryKind = "protocol" | "addendum";

type PendingDelivery = {
  kind:DeliveryKind;
  bookingId:number;
  bookingCode:string;
  patientName:string;
  serviceTitle:string;
  documentNumber:string;
  version:number;
  signedBy:string;
  signedAt:string;
  addendumId:string;
  baseProtocolVersion:number;
};

function assignmentClause(role:string, alias:string) {
  return role === "radiologist" ? ` AND ${alias}.assigned_radiologist_email = ?` : "";
}

function assignmentBinds(role:string, email:string) {
  return role === "radiologist" ? [email] : [] as string[];
}

function safeVersion(value:unknown) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

export async function GET(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canDeliverResults(ctx.member.role)) {
    return Response.json({error:"Видача результатів недоступна для цієї ролі"},{status:403});
  }

  const clause=assignmentClause(ctx.member.role,"b");
  const binds=assignmentBinds(ctx.member.role,ctx.member.email);
  const [protocols,addenda]=await Promise.all([
    db.prepare(
      `SELECT 'protocol' AS kind,b.id AS bookingId,b.code AS bookingCode,b.name AS patientName,
              b.service AS serviceTitle,p.number AS documentNumber,p.version,
              p.signed_by AS signedBy,p.signed_at AS signedAt,
              '' AS addendumId,0 AS baseProtocolVersion
       FROM protocols p
       JOIN bookings b ON b.id=p.booking_id AND b.organization_id=p.organization_id
       WHERE p.organization_id=? AND p.status='signed'${clause}
       ORDER BY p.signed_at,b.id LIMIT 300`,
    ).bind(ctx.organizationId,...binds).all<PendingDelivery>(),
    db.prepare(
      `SELECT 'addendum' AS kind,b.id AS bookingId,b.code AS bookingCode,b.name AS patientName,
              b.service AS serviceTitle,p.number AS documentNumber,a.version,
              a.signed_by AS signedBy,a.signed_at AS signedAt,
              a.id AS addendumId,a.base_protocol_version AS baseProtocolVersion
       FROM protocol_addenda a
       JOIN bookings b ON b.id=a.booking_id AND b.organization_id=a.organization_id
       JOIN protocols p ON p.booking_id=a.booking_id AND p.organization_id=a.organization_id
       WHERE a.organization_id=? AND a.status='signed' AND p.status='issued'
         AND p.version=a.base_protocol_version${clause}
       ORDER BY a.signed_at,a.id LIMIT 300`,
    ).bind(ctx.organizationId,...binds).all<PendingDelivery>(),
  ]);

  const pending=[...(protocols.results||[]),...(addenda.results||[])]
    .sort((a,b)=>String(a.signedAt).localeCompare(String(b.signedAt)))
    .slice(0,500);
  await audit(db,{
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"result_delivery_queue_viewed",
    resource:"result_delivery_queue",
    details:{rows:pending.length},
  });
  return Response.json({pending,staff:ctx.member},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canDeliverResults(ctx.member.role)) {
    return Response.json({error:"Видача результатів недоступна для цієї ролі"},{status:403});
  }

  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const kind=String(body.kind||"") as DeliveryKind;
  const expectedVersion=safeVersion(body.version);
  if((kind!=="protocol"&&kind!=="addendum")||!expectedVersion) {
    return Response.json({error:"Некоректний документ для видачі"},{status:400});
  }

  if(kind==="protocol") {
    const bookingId=Number(body.bookingId);
    if(!Number.isInteger(bookingId)||bookingId<1) return Response.json({error:"Некоректна заявка"},{status:400});
    if(!await canAccessBooking(db,ctx.member,bookingId,ctx.organizationId)) {
      return Response.json({error:"Результат не знайдено або дослідження не призначено вам"},{status:404});
    }
    const protocol=await db.prepare(
      `SELECT version,status,number,signed_by AS signedBy,signed_at AS signedAt
       FROM protocols WHERE organization_id=? AND booking_id=? LIMIT 1`,
    ).bind(ctx.organizationId,bookingId).first<{
      version:number;status:string;number:string;signedBy:string;signedAt:string;
    }>();
    if(!protocol) return Response.json({error:"Протокол не знайдено"},{status:404});
    if(protocol.status!=="signed") return Response.json({error:"До видачі доступний лише підписаний протокол"},{status:409});
    if(Number(protocol.version)!==expectedVersion) return Response.json({error:"Версія протоколу змінилася. Оновіть список видачі."},{status:409});

    let result;
    try {
      result=await db.prepare(
        `UPDATE protocols SET status='issued',updated_by=?,updated_at=CURRENT_TIMESTAMP
         WHERE organization_id=? AND booking_id=? AND status='signed' AND version=?`,
      ).bind(ctx.member.email,ctx.organizationId,bookingId,expectedVersion).run();
    } catch {
      return Response.json({error:"Не вдалося видати підписаний протокол. Оновіть список видачі."},{status:409});
    }
    if(Number(result.meta.changes||0)!==1) return Response.json({error:"Статус протоколу змінився. Оновіть список видачі."},{status:409});

    const delivery=await db.prepare(
      `SELECT d.id AS documentId,d.number,r.delivered_by AS deliveredBy,r.delivered_at AS deliveredAt
       FROM result_delivery_details r
       JOIN business_documents d ON d.id=r.document_id AND d.organization_id=r.organization_id
       WHERE r.organization_id=? AND r.booking_id=? LIMIT 1`,
    ).bind(ctx.organizationId,bookingId).first<{documentId:number;number:string;deliveredBy:string;deliveredAt:string}>();
    if(!delivery || delivery.deliveredBy!==ctx.member.email) {
      return Response.json({error:"Не вдалося підтвердити реєстратор видачі"},{status:409});
    }
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:"protocol_issued",resource:"protocol",targetId:bookingId,
      details:{version:expectedVersion,deliveryDocumentId:delivery.documentId,deliverySurface:"result_deliveries"},
    });
    return Response.json({ok:true,kind,bookingId,version:expectedVersion,documentNumber:protocol.number,delivery});
  }

  const addendumId=String(body.addendumId||"").trim().toLowerCase();
  if(!ADDENDUM_ID_RE.test(addendumId)) return Response.json({error:"Некоректне виправлення"},{status:400});
  const addendum=await db.prepare(
    `SELECT booking_id AS bookingId,base_protocol_version AS baseProtocolVersion,version,status,
            signed_by AS signedBy,signed_at AS signedAt
     FROM protocol_addenda WHERE organization_id=? AND id=? LIMIT 1`,
  ).bind(ctx.organizationId,addendumId).first<{
    bookingId:number;baseProtocolVersion:number;version:number;status:string;signedBy:string;signedAt:string;
  }>();
  if(!addendum) return Response.json({error:"Виправлення не знайдено"},{status:404});
  if(!await canAccessBooking(db,ctx.member,addendum.bookingId,ctx.organizationId)) {
    return Response.json({error:"Виправлення не знайдено або дослідження не призначено вам"},{status:404});
  }
  if(addendum.status!=="signed") return Response.json({error:"До видачі доступне лише підписане виправлення"},{status:409});
  if(Number(addendum.version)!==expectedVersion) return Response.json({error:"Версія виправлення змінилася. Оновіть список видачі."},{status:409});

  let result;
  try {
    result=await db.prepare(
      `UPDATE protocol_addenda SET status='issued',updated_by=?,updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=? AND id=? AND status='signed' AND version=?`,
    ).bind(ctx.member.email,ctx.organizationId,addendumId,expectedVersion).run();
  } catch {
    return Response.json({error:"Не вдалося видати підписане виправлення. Оновіть список видачі."},{status:409});
  }
  if(Number(result.meta.changes||0)!==1) return Response.json({error:"Статус виправлення змінився. Оновіть список видачі."},{status:409});

  const delivery=await db.prepare(
    `SELECT d.id AS documentId,d.number,r.delivered_by AS deliveredBy,r.delivered_at AS deliveredAt
     FROM result_addendum_delivery_details r
     JOIN business_documents d ON d.id=r.document_id AND d.organization_id=r.organization_id
     WHERE r.organization_id=? AND r.addendum_id=? LIMIT 1`,
  ).bind(ctx.organizationId,addendumId).first<{documentId:number;number:string;deliveredBy:string;deliveredAt:string}>();
  if(!delivery || delivery.deliveredBy!==ctx.member.email) {
    return Response.json({error:"Не вдалося підтвердити реєстратор видачі виправлення"},{status:409});
  }
  await audit(db,{
    organizationId:ctx.organizationId,actorEmail:ctx.member.email,
    action:"protocol_addendum_issued",resource:"protocol_addendum",targetId:addendumId,
    details:{bookingId:addendum.bookingId,version:expectedVersion,baseProtocolVersion:addendum.baseProtocolVersion,deliveryDocumentId:delivery.documentId,deliverySurface:"result_deliveries"},
  });
  return Response.json({ok:true,kind,bookingId:addendum.bookingId,addendumId,version:expectedVersion,delivery});
}
