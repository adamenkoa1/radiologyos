import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import {
  cancelInventoryTransfer,
  createInventoryTransfer,
  getInventoryTransfer,
  listInventoryTransfers,
  postInventoryTransfer,
  type InventoryTransferLineInput,
} from "../../../../../lib/inventory-transfers";
import { requireOrgContext } from "../../../../../lib/tenant";

const MANAGER_ROLES=new Set(["admin","radiographer"]);
function canManage(role:string){return MANAGER_ROLES.has(role);}
function int(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max);}

function mapCreateError(error:unknown){
  const code=String(error instanceof Error?error.message:error);
  if(code.includes("lines_required"))return[400,"Додайте хоча б один рядок переміщення"] as const;
  if(code.includes("invalid_quantity"))return[400,"Кількість має бути більшою за нуль"] as const;
  if(code.includes("warehouse_required"))return[400,"Вкажіть склад-відправник і склад-одержувач"] as const;
  if(code.includes("same_warehouse"))return[400,"Склад-відправник і склад-одержувач мають відрізнятися"] as const;
  if(code.includes("warehouse_not_found"))return[404,"Склад не знайдено або він неактивний"] as const;
  if(code.includes("lot_required"))return[400,"Вкажіть партію для переміщення"] as const;
  if(code.includes("lot_not_found"))return[404,"Партію не знайдено або матеріал неактивний"] as const;
  return null;
}

export async function GET(request:Request){
  const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const url=new URL(request.url);const id=int(url.searchParams.get("id"));
  if(id){
    const detail=await getInventoryTransfer(db,ctx.organizationId,id);
    if(!detail)return Response.json({error:"Документ переміщення не знайдено"},{status:404});
    return Response.json({...detail,staff:ctx.member,canManage:canManage(ctx.role)});
  }
  const documents=await listInventoryTransfers(db,ctx.organizationId);
  return Response.json({documents,staff:ctx.member,canManage:canManage(ctx.role)});
}

export async function POST(request:Request){
  const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canManage(ctx.role))return Response.json({error:"Переміщення запасів можуть змінювати адміністратор або рентгенолаборант"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;const action=clean(body.action,30);

  if(action==="create"){
    const lines=Array.isArray(body.lines)?body.lines as InventoryTransferLineInput[]:[];
    try{
      const created=await createInventoryTransfer(db,{
        organizationId:ctx.organizationId,actorEmail:ctx.member.email,
        occurredAt:clean(body.occurredAt,32)||undefined,comment:clean(body.comment,500),lines,
      });
      if(!created)return Response.json({error:"Не вдалося створити документ переміщення"},{status:500});
      await audit(db,{
        organizationId:ctx.organizationId,actorEmail:ctx.member.email,
        action:"inventory_transfer_created",resource:"business_document",targetId:created.document.id,
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
    const result=await postInventoryTransfer(db,{organizationId:ctx.organizationId,documentId,actorEmail:ctx.member.email});
    if(!result.ok)return Response.json({error:result.error},{status:result.status});
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:result.idempotent?"inventory_transfer_post_replayed":"inventory_transfer_posted",
      resource:"business_document",targetId:documentId,details:{idempotent:result.idempotent},
    });
    return Response.json(result.document);
  }
  if(action==="cancel"){
    const ok=await cancelInventoryTransfer(db,ctx.organizationId,documentId);
    if(!ok){
      const current=await getInventoryTransfer(db,ctx.organizationId,documentId);
      if(!current)return Response.json({error:"Документ переміщення не знайдено"},{status:404});
      return Response.json({error:"Скасувати можна лише чернетку"},{status:409});
    }
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:"inventory_transfer_cancelled",resource:"business_document",targetId:documentId,
    });
    return Response.json({ok:true});
  }
  return Response.json({error:"Невідома дія з документом переміщення"},{status:400});
}
