import { audit } from "../../../../../../lib/audit";
import { dbBinding } from "../../../../../../lib/db";
import { getInventoryDocument } from "../../../../../../lib/inventory-documents";
import { requireOrgContext } from "../../../../../../lib/tenant";

const TEMPLATE_VERSION = 1;

function int(value:unknown) {
  const n=Number(value);
  return Number.isInteger(n)&&n>0?n:null;
}

async function sha256(value:string) {
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}

async function renderPayload(db:D1Database,organizationId:number,documentId:number) {
  const detail=await getInventoryDocument(db,organizationId,documentId);
  if(!detail) return null;
  const organization=await db.prepare("SELECT name FROM organizations WHERE id=? LIMIT 1")
    .bind(organizationId).first<{name:string}>();
  const lines=await db.prepare(
    `SELECT l.line_no AS lineNo,l.item_id AS itemId,i.name AS itemName,i.unit,
            l.lot_number AS lotNumber,l.expires_on AS expiresOn,l.supplier,l.quantity,l.reason,
            l.booking_id AS bookingId
     FROM inventory_document_lines l
     JOIN inventory_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
     WHERE l.organization_id=? AND l.document_id=? ORDER BY l.line_no,l.id`
  ).bind(organizationId,documentId).all<{
    lineNo:number;itemId:number;itemName:string;unit:string;lotNumber:string;expiresOn:string;
    supplier:string;quantity:number;reason:string;bookingId:number|null;
  }>();
  return {
    templateVersion:TEMPLATE_VERSION,
    formType:detail.document.documentType,
    organization:{name:organization?.name || "Організація"},
    document:{
      id:detail.document.id,
      number:detail.document.number,
      documentType:detail.document.documentType,
      occurredAt:detail.document.occurredAt,
      state:detail.document.state,
      comment:detail.document.comment,
      createdBy:detail.document.createdBy,
      createdAt:detail.document.createdAt,
      postedBy:detail.document.postedBy,
      postedAt:detail.document.postedAt,
    },
    lines:lines.results,
  };
}

export async function GET(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const url=new URL(request.url);
  const snapshotId=int(url.searchParams.get("snapshotId"));
  if(!snapshotId) return Response.json({error:"Некоректна друкована форма"},{status:400});
  const row=await db.prepare(
    `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
            payload_json AS payloadJson,generated_by AS generatedBy,generated_at AS generatedAt,
            storage_key AS storageKey,sha256
     FROM printed_form_snapshots WHERE organization_id=? AND id=? LIMIT 1`
  ).bind(ctx.organizationId,snapshotId).first<{
    id:number;documentId:number;formType:string;templateVersion:number;payloadJson:string;
    generatedBy:string;generatedAt:string;storageKey:string;sha256:string;
  }>();
  if(!row) return Response.json({error:"Друковану форму не знайдено"},{status:404});
  return Response.json({snapshot:{...row,payloadJson:undefined},payload:JSON.parse(row.payloadJson)});
}

export async function POST(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const documentId=int(body.documentId);
  if(!documentId) return Response.json({error:"Некоректний документ"},{status:400});
  const payload=await renderPayload(db,ctx.organizationId,documentId);
  if(!payload) return Response.json({error:"Документ не знайдено"},{status:404});
  const formType=payload.formType;
  const payloadJson=JSON.stringify(payload);
  const hash=await sha256(payloadJson);
  await db.prepare(
    `INSERT OR IGNORE INTO printed_form_snapshots
      (organization_id,document_id,form_type,template_version,payload_json,generated_by,sha256)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(ctx.organizationId,documentId,formType,TEMPLATE_VERSION,payloadJson,ctx.member.email,hash).run();
  const snapshot=await db.prepare(
    `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
            generated_by AS generatedBy,generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots
     WHERE organization_id=? AND document_id=? AND form_type=? AND template_version=? AND sha256=?
     LIMIT 1`
  ).bind(ctx.organizationId,documentId,formType,TEMPLATE_VERSION,hash).first();
  await audit(db,{
    organizationId:ctx.organizationId,actorEmail:ctx.member.email,
    action:"printed_form_generated",resource:"business_document",targetId:documentId,
    details:{formType,templateVersion:TEMPLATE_VERSION,snapshotId:Number((snapshot as {id?:number}|null)?.id || 0)},
  });
  return Response.json({snapshot,payload},{status:201});
}
