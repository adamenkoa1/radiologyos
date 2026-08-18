import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import {
  cancelInventoryCount,
  createInventoryCount,
  getInventoryCount,
  listInventoryCounts,
  postInventoryCount,
  type InventoryCountLineInput,
} from "../../../../../lib/inventory-counts";
import { requireOrgContext } from "../../../../../lib/tenant";

const MANAGER_ROLES=new Set(["admin","radiographer"]);
function canManage(role:string){return MANAGER_ROLES.has(role);}
function int(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max);}

function mapCreateError(error:unknown){
  const code=String(error instanceof Error?error.message:error);
  if(code.includes("lines_required"))return[400,"Додайте хоча б один рядок інвентаризації"] as const;
  if(code.includes("invalid_quantity"))return[400,"Фактична кількість має бути нуль або більше"] as const;
  if(code.includes("warehouse_required"))return[400,"Вкажіть склад"] as const;
  if(code.includes("warehouse_not_found"))return[404,"Склад не знайдено або він неактивний"] as const;
  if(code.includes("lot_required"))return[400,"Вкажіть партію"] as const;
  if(code.includes("lot_not_found"))return[404,"Партію не знайдено або матеріал неактивний"] as const;
  if(code.includes("duplicate_bucket"))return[409,"Одна партія на одному складі може бути вказана лише один раз"] as const;
  if(code.includes("invalid_book_balance"))return[409,"Обліковий залишок пошкоджений: інвентаризацію не створено"] as const;
  if(code.includes("inventory_count_book_mismatch"))return[409,"Залишок змінився під час створення інвентаризації. Повторіть створення"] as const;
  return null;
}

export async function GET(request:Request){
  const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const url=new URL(request.url);const id=int(url.searchParams.get("id"));
  if(id){
    const detail=await getInventoryCount(db,ctx.organizationId,id);
    if(!detail)return Response.json({error:"Документ інвентаризації не знайдено"},{status:404});
    return Response.json({...detail,staff:ctx.member,canManage:canManage(ctx.role)});
  }
  const documents=await listInventoryCounts(db,ctx.organizationId);
  return Response.json({documents,staff:ctx.member,canManage:canManage(ctx.role)});
}

export async function POST(request:Request){
  const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canManage(ctx.role))return Response.json({error:"Інвентаризацію можуть змінювати адміністратор або рентгенолаборант"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;const action=clean(body.action,30);

  if(action==="create"){
    const lines=Array.isArray(body.lines)?body.lines as InventoryCountLineInput[]:[];
    try{
      const created=await createInventoryCount(db,{
        organizationId:ctx.organizationId,actorEmail:ctx.member.email,
        occurredAt:clean(body.occurredAt,32)||undefined,comment:clean(body.comment,500),lines,
      });
      if(!created)return Response.json({error:"Не вдалося створити інвентаризацію"},{status:500});
      await audit(db,{
        organizationId:ctx.organizationId,actorEmail:ctx.member.email,
        action:"inventory_count_created",resource:"business_document",targetId:created.document.id,
        details:{lineCount:created.lines.length},
      });
      return Response.json(created,{status:201});
    }catch(error){
      const mapped=mapCreateError(error);if(mapped)return Response.json({error:mapped[1]},{status:mapped[0]});
      throw error;
    }
  }

  const documentId=int(body.documentId);if(!documentId)return Response.json({error:"Некоректний документ"},{status:400});
  if(action==="post"){
    const result=await postInventoryCount(db,{organizationId:ctx.organizationId,documentId,actorEmail:ctx.member.email});
    if(!result.ok)return Response.json({error:result.error},{status:result.status});
    const adjustedLines=result.document?.lines.filter(line=>Math.abs(Number(line.discrepancyQuantity))>0.000001).length||0;
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:result.idempotent?"inventory_count_post_replayed":"inventory_count_posted",
      resource:"business_document",targetId:documentId,details:{idempotent:result.idempotent,adjustedLineCount:adjustedLines},
    });
    return Response.json(result.document);
  }
  if(action==="cancel"){
    const ok=await cancelInventoryCount(db,ctx.organizationId,documentId);
    if(!ok){
      const current=await getInventoryCount(db,ctx.organizationId,documentId);
      if(!current)return Response.json({error:"Документ інвентаризації не знайдено"},{status:404});
      return Response.json({error:"Скасувати можна лише чернетку"},{status:409});
    }
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:"inventory_count_cancelled",resource:"business_document",targetId:documentId,
    });
    return Response.json({ok:true});
  }
  return Response.json({error:"Невідома дія з інвентаризацією"},{status:400});
}
