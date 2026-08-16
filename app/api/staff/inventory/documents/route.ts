import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import {
  cancelInventoryDocument,
  createInventoryDocument,
  getInventoryDocument,
  isInventoryDocumentType,
  listInventoryDocuments,
  postInventoryDocument,
  updateInventoryDocumentDraft,
  type InventoryDocumentLineInput,
} from "../../../../../lib/inventory-documents";
import { requireOrgContext } from "../../../../../lib/tenant";

const MANAGER_ROLES = new Set(["admin","radiographer"]);

function canManage(role:string) { return MANAGER_ROLES.has(role); }
function int(value:unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function clean(value:unknown,max:number) { return String(value ?? "").trim().slice(0,max); }

function mapCreateError(error:unknown) {
  const code = String(error instanceof Error ? error.message : error);
  if (code.includes("lines_required")) return [400,"Додайте хоча б один рядок документа"] as const;
  if (code.includes("invalid_quantity")) return [400,"Кількість має бути більшою за нуль"] as const;
  if (code.includes("warehouse_not_found")) return [404,"Склад не знайдено або він неактивний"] as const;
  if (code.includes("transfer_warehouse_required")) return [400,"Для переміщення вкажіть склад-відправник і склад-одержувач"] as const;
  if (code.includes("transfer_same_warehouse")) return [400,"Склад-відправник і склад-одержувач мають бути різними"] as const;
  if (code.includes("item_required")) return [400,"Для надходження вкажіть матеріал"] as const;
  if (code.includes("item_not_found")) return [404,"Матеріал не знайдено або він неактивний"] as const;
  if (code.includes("invalid_expiry")) return [400,"Некоректний термін придатності"] as const;
  if (code.includes("supplier_not_found")) return [404,"Постачальника не знайдено, він неактивний або не є постачальником"] as const;
  if (code.includes("lot_required")) return [400,"Для списання або переміщення вкажіть партію"] as const;
  if (code.includes("lot_not_found")) return [404,"Партію не знайдено або матеріал неактивний"] as const;
  if (code.includes("booking_not_found")) return [400,"Дослідження не належить до цієї організації"] as const;
  if (code.includes("reason_required")) return [400,"Вкажіть причину списання"] as const;
  return null;
}

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" },{status:503});
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" },{status:403});
  const url = new URL(request.url);
  const id = int(url.searchParams.get("id"));
  if (id) {
    const detail = await getInventoryDocument(db,ctx.organizationId,id);
    if (!detail) return Response.json({ error:"Документ не знайдено" },{status:404});
    return Response.json({ ...detail, staff:ctx.member, canManage:canManage(ctx.role) });
  }
  const documents = await listInventoryDocuments(db,ctx.organizationId);
  return Response.json({ documents, staff:ctx.member, canManage:canManage(ctx.role) });
}

export async function POST(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" },{status:503});
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" },{status:403});
  if (!canManage(ctx.role)) return Response.json({ error:"Складські документи можуть змінювати адміністратор або рентгенолаборант" },{status:403});
  const body = await request.json().catch(()=>({})) as Record<string,unknown>;
  const action = clean(body.action,30);

  if (action === "create") {
    if (!isInventoryDocumentType(body.documentType)) return Response.json({ error:"Некоректний тип складського документа" },{status:400});
    const lines = Array.isArray(body.lines) ? body.lines as InventoryDocumentLineInput[] : [];
    try {
      const created = await createInventoryDocument(db,{
        organizationId:ctx.organizationId,
        actorEmail:ctx.member.email,
        type:body.documentType,
        occurredAt:clean(body.occurredAt,32) || undefined,
        comment:clean(body.comment,500),
        sourceWarehouseId:int(body.sourceWarehouseId),
        destinationWarehouseId:int(body.destinationWarehouseId),
        lines,
      });
      if (!created) return Response.json({ error:"Не вдалося створити документ" },{status:500});
      await audit(db,{
        organizationId:ctx.organizationId,actorEmail:ctx.member.email,
        action:"inventory_document_created",resource:"business_document",targetId:created.document.id,
        details:{
          type:created.document.documentType,lineCount:created.lines.length,
          sourceWarehouseId:created.transfer?.sourceWarehouseId ?? null,
          destinationWarehouseId:created.transfer?.destinationWarehouseId ?? null,
        },
      });
      return Response.json(created,{status:201});
    } catch (error) {
      const mapped = mapCreateError(error);
      if (mapped) return Response.json({error:mapped[1]},{status:mapped[0]});
      throw error;
    }
  }

  const documentId = int(body.documentId);
  if (!documentId) return Response.json({ error:"Некоректний документ" },{status:400});

  if (action === "post") {
    const result = await postInventoryDocument(db,{organizationId:ctx.organizationId,documentId,actorEmail:ctx.member.email});
    if (!result.ok) return Response.json({error:result.error},{status:result.status});
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:result.idempotent ? "inventory_document_post_replayed" : "inventory_document_posted",
      resource:"business_document",targetId:documentId,
      details:{ idempotent:result.idempotent },
    });
    return Response.json(result.document);
  }

  if (action === "cancel") {
    const ok = await cancelInventoryDocument(db,ctx.organizationId,documentId);
    if (!ok) {
      const current = await getInventoryDocument(db,ctx.organizationId,documentId);
      if (!current) return Response.json({error:"Документ не знайдено"},{status:404});
      return Response.json({error:"Скасувати можна лише чернетку"},{status:409});
    }
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:"inventory_document_cancelled",resource:"business_document",targetId:documentId,
    });
    return Response.json({ok:true});
  }

  return Response.json({ error:"Невідома дія з документом" },{status:400});
}

export async function PATCH(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" },{status:503});
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" },{status:403});
  if (!canManage(ctx.role)) return Response.json({ error:"Складські документи можуть змінювати адміністратор або рентгенолаборант" },{status:403});
  const body = await request.json().catch(()=>({})) as Record<string,unknown>;
  const documentId = int(body.documentId);
  if (!documentId) return Response.json({ error:"Некоректний документ" },{status:400});
  const result = await updateInventoryDocumentDraft(db,{
    organizationId:ctx.organizationId,
    documentId,
    occurredAt:body.occurredAt === undefined ? undefined : clean(body.occurredAt,32),
    comment:body.comment === undefined ? undefined : clean(body.comment,500),
  });
  if (!result.ok) {
    if (result.reason === "not_found") return Response.json({error:"Документ не знайдено"},{status:404});
    if (result.reason === "not_draft") return Response.json({error:"Проведений документ не редагується; використайте коригування/сторно"},{status:409});
    return Response.json({error:"Некоректні дані документа"},{status:400});
  }
  await audit(db,{
    organizationId:ctx.organizationId,actorEmail:ctx.member.email,
    action:"inventory_document_updated",resource:"business_document",targetId:documentId,
  });
  return Response.json(result.document);
}
