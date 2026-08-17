import { audit } from "../../../../../../lib/audit";
import { dbBinding } from "../../../../../../lib/db";
import { getInventoryDocument } from "../../../../../../lib/inventory-documents";
import { printedFormStorageKey } from "../../../../../../lib/printed-form-storage-key";
import { requireOrgContext } from "../../../../../../lib/tenant";

const TEMPLATE_VERSION = 2;

type SnapshotRow={
  id:number;documentId:number;formType:string;templateVersion:number;documentState:string;
  payloadJson:string;generatedBy:string;generatedAt:string;storageKey:string;sha256:string;
};

function int(value:unknown) {
  const n=Number(value);
  return Number.isInteger(n)&&n>0?n:null;
}

async function sha256(value:string) {
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}

function publicSnapshot(row:SnapshotRow) {
  const {payloadJson:_,...snapshot}=row;
  void _;
  return snapshot;
}

async function renderPayload(db:D1Database,organizationId:number,documentId:number) {
  const detail=await getInventoryDocument(db,organizationId,documentId);
  if(!detail) return null;
  const organization=await db.prepare("SELECT name FROM organizations WHERE id=? LIMIT 1")
    .bind(organizationId).first<{name:string}>();
  const lines=await db.prepare(
    `SELECT l.line_no AS lineNo,l.item_id AS itemId,i.name AS itemName,i.unit,
            l.warehouse_id AS warehouseId,l.warehouse_code AS warehouseCode,l.warehouse_name AS warehouseName,
            l.lot_number AS lotNumber,l.expires_on AS expiresOn,l.supplier,l.quantity,l.reason,
            l.booking_id AS bookingId
     FROM inventory_document_lines l
     JOIN inventory_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
     WHERE l.organization_id=? AND l.document_id=? ORDER BY l.line_no,l.id`
  ).bind(organizationId,documentId).all<{
    lineNo:number;itemId:number;itemName:string;unit:string;warehouseId:number;warehouseCode:string;warehouseName:string;
    lotNumber:string;expiresOn:string;supplier:string;quantity:number;reason:string;bookingId:number|null;
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
            document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
            generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots WHERE organization_id=? AND id=? LIMIT 1`
  ).bind(ctx.organizationId,snapshotId).first<SnapshotRow>();
  if(!row) return Response.json({error:"Друковану форму не знайдено"},{status:404});
  return Response.json({snapshot:publicSnapshot(row),payload:JSON.parse(row.payloadJson)});
}

export async function POST(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const documentId=int(body.documentId);
  if(!documentId) return Response.json({error:"Некоректний документ"},{status:400});

  const detail=await getInventoryDocument(db,ctx.organizationId,documentId);
  if(!detail) return Response.json({error:"Документ не знайдено"},{status:404});
  const formType=detail.document.documentType;
  const documentState=detail.document.state;

  // Once a document leaves draft, its earliest snapshot for that document/type/state is the
  // canonical reprint across template upgrades. A later template may enrich first-time prints,
  // but it must never silently replace what was already printed for the posted document.
  if(documentState!=="draft") {
    const existing=await db.prepare(
      `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
              document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
              generated_at AS generatedAt,storage_key AS storageKey,sha256
       FROM printed_form_snapshots
       WHERE organization_id=? AND document_id=? AND form_type=? AND document_state=?
       ORDER BY id ASC LIMIT 1`
    ).bind(ctx.organizationId,documentId,formType,documentState).first<SnapshotRow>();
    if(existing) {
      await audit(db,{
        organizationId:ctx.organizationId,actorEmail:ctx.member.email,
        action:"printed_form_reprinted",resource:"business_document",targetId:documentId,
        details:{formType,templateVersion:existing.templateVersion,snapshotId:existing.id},
      });
      return Response.json({snapshot:publicSnapshot(existing),payload:JSON.parse(existing.payloadJson)});
    }
  }

  const payload=await renderPayload(db,ctx.organizationId,documentId);
  if(!payload) return Response.json({error:"Документ не знайдено"},{status:404});
  const payloadJson=JSON.stringify(payload);
  const hash=await sha256(payloadJson);
  const storageKey=printedFormStorageKey({organizationId:ctx.organizationId,documentId,formType,templateVersion:TEMPLATE_VERSION,documentState,sha256:hash});
  await db.prepare(
    `INSERT OR IGNORE INTO printed_form_snapshots
      (organization_id,document_id,form_type,template_version,document_state,payload_json,generated_by,storage_key,sha256)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(ctx.organizationId,documentId,formType,TEMPLATE_VERSION,documentState,payloadJson,ctx.member.email,storageKey,hash).run();
  const snapshot=await db.prepare(
    `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
            document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
            generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots
     WHERE organization_id=? AND document_id=? AND form_type=? AND template_version=? AND document_state=? AND sha256=?
     LIMIT 1`
  ).bind(ctx.organizationId,documentId,formType,TEMPLATE_VERSION,documentState,hash).first<SnapshotRow>();
  if(!snapshot) return Response.json({error:"Не вдалося зберегти друковану форму"},{status:500});
  await audit(db,{
    organizationId:ctx.organizationId,actorEmail:ctx.member.email,
    action:"printed_form_generated",resource:"business_document",targetId:documentId,
    details:{formType,templateVersion:TEMPLATE_VERSION,snapshotId:snapshot.id},
  });
  return Response.json({snapshot:publicSnapshot(snapshot),payload},{status:201});
}
