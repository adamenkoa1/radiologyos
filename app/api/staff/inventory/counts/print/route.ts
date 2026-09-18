import { audit } from "../../../../../../lib/audit";
import { dbBinding } from "../../../../../../lib/db";
import { getInventoryCount } from "../../../../../../lib/inventory-counts";
import { printedFormStorageKey } from "../../../../../../lib/printed-form-storage-key";
import { requireOrgContext } from "../../../../../../lib/tenant";

const TEMPLATE_VERSION=1;
const FORM_TYPE="inventory_count";

type SnapshotRow={
  id:number;documentId:number;formType:string;templateVersion:number;documentState:string;
  payloadJson:string;generatedBy:string;generatedAt:string;storageKey:string;sha256:string;
};

function int(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
async function sha256(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
function publicSnapshot(row:SnapshotRow){const {payloadJson:_,...snapshot}=row;void _;return snapshot;}

async function renderPayload(db:D1Database,organizationId:number,documentId:number){
  const detail=await getInventoryCount(db,organizationId,documentId);
  if(!detail)return null;
  const organization=await db.prepare("SELECT name FROM organizations WHERE id=? LIMIT 1")
    .bind(organizationId).first<{name:string}>();
  return{
    templateVersion:TEMPLATE_VERSION,
    formType:FORM_TYPE,
    organization:{name:organization?.name||"Організація"},
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
    lines:detail.lines.map(line=>({
      lineNo:line.lineNo,
      itemId:line.itemId,
      itemName:line.itemName,
      unit:line.itemUnit,
      lotId:line.lotId,
      lotNumber:line.lotNumber,
      warehouseId:line.warehouseId,
      warehouseCode:line.warehouseCode,
      warehouseName:line.warehouseName,
      bookQuantity:line.bookQuantity,
      countedQuantity:line.countedQuantity,
      discrepancyQuantity:line.discrepancyQuantity,
      reason:line.reason,
    })),
  };
}

export async function GET(request:Request){
  const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const snapshotId=int(new URL(request.url).searchParams.get("snapshotId"));
  if(!snapshotId)return Response.json({error:"Некоректна друкована форма"},{status:400});
  const row=await db.prepare(
    `SELECT s.id,s.document_id AS documentId,s.form_type AS formType,s.template_version AS templateVersion,
            s.document_state AS documentState,s.payload_json AS payloadJson,s.generated_by AS generatedBy,
            s.generated_at AS generatedAt,s.storage_key AS storageKey,s.sha256
     FROM printed_form_snapshots s
     JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
     WHERE s.organization_id=? AND s.id=? AND s.form_type='inventory_count' AND d.document_type='inventory_count' LIMIT 1`
  ).bind(ctx.organizationId,snapshotId).first<SnapshotRow>();
  if(!row)return Response.json({error:"Друковану форму не знайдено"},{status:404});
  return Response.json({snapshot:publicSnapshot(row),payload:JSON.parse(row.payloadJson)});
}

export async function POST(request:Request){
  const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const documentId=int(body.documentId);if(!documentId)return Response.json({error:"Некоректний документ"},{status:400});
  const detail=await getInventoryCount(db,ctx.organizationId,documentId);
  if(!detail)return Response.json({error:"Документ інвентаризації не знайдено"},{status:404});
  const documentState=detail.document.state;

  if(documentState!=="draft"){
    const existing=await db.prepare(
      `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
              document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
              generated_at AS generatedAt,storage_key AS storageKey,sha256
       FROM printed_form_snapshots
       WHERE organization_id=? AND document_id=? AND form_type='inventory_count' AND document_state=?
       ORDER BY id ASC LIMIT 1`
    ).bind(ctx.organizationId,documentId,documentState).first<SnapshotRow>();
    if(existing){
      await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"printed_form_reprinted",resource:"business_document",targetId:documentId,details:{formType:FORM_TYPE,templateVersion:existing.templateVersion,snapshotId:existing.id}});
      return Response.json({snapshot:publicSnapshot(existing),payload:JSON.parse(existing.payloadJson)});
    }
  }

  const payload=await renderPayload(db,ctx.organizationId,documentId);
  if(!payload)return Response.json({error:"Документ інвентаризації не знайдено"},{status:404});
  const payloadJson=JSON.stringify(payload),hash=await sha256(payloadJson);
  const storageKey=printedFormStorageKey({organizationId:ctx.organizationId,documentId,formType:FORM_TYPE,templateVersion:TEMPLATE_VERSION,documentState,sha256:hash});
  await db.prepare(
    `INSERT OR IGNORE INTO printed_form_snapshots
      (organization_id,document_id,form_type,template_version,document_state,payload_json,generated_by,storage_key,sha256)
     VALUES (? ,?,'inventory_count',?,?,?,?,?,?)`
  ).bind(ctx.organizationId,documentId,TEMPLATE_VERSION,documentState,payloadJson,ctx.member.email,storageKey,hash).run();
  const snapshot=await db.prepare(
    `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
            document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
            generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots
     WHERE organization_id=? AND document_id=? AND form_type='inventory_count' AND template_version=? AND document_state=? AND sha256=?
     LIMIT 1`
  ).bind(ctx.organizationId,documentId,TEMPLATE_VERSION,documentState,hash).first<SnapshotRow>();
  if(!snapshot)return Response.json({error:"Не вдалося зберегти друковану форму"},{status:500});
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"printed_form_generated",resource:"business_document",targetId:documentId,details:{formType:FORM_TYPE,templateVersion:TEMPLATE_VERSION,snapshotId:snapshot.id}});
  return Response.json({snapshot:publicSnapshot(snapshot),payload},{status:201});
}
