import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { getServiceDeliveryDocument } from "../../../../../lib/service-delivery";
import { canManageFinance } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

const TEMPLATE_VERSION=1;
const FORM_TYPE="service_act";

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
  const serviceAct=await getServiceDeliveryDocument(db,organizationId,documentId);
  if(!serviceAct) return null;
  const organization=await db.prepare("SELECT name FROM organizations WHERE id=? LIMIT 1")
    .bind(organizationId).first<{name:string}>();
  return {
    templateVersion:TEMPLATE_VERSION,
    formType:FORM_TYPE,
    organization:{name:organization?.name || "Організація"},
    document:{
      id:serviceAct.id,
      number:serviceAct.number,
      documentType:"service_delivery",
      occurredAt:serviceAct.occurredAt,
      state:serviceAct.state,
      createdBy:serviceAct.createdBy,
      postedBy:serviceAct.postedBy,
      postedAt:serviceAct.postedAt,
    },
    booking:{
      id:serviceAct.bookingId,
      code:serviceAct.bookingCode,
      patientName:serviceAct.patientName,
      patientId:serviceAct.patientId,
      patientCategory:serviceAct.patientCategory,
    },
    service:{
      code:serviceAct.serviceCode,
      name:serviceAct.serviceName,
      chargeAmount:serviceAct.chargeAmount,
      currency:serviceAct.currency,
    },
    execution:{
      equipmentId:serviceAct.equipmentId,
      durationMinutes:serviceAct.durationMinutes,
      performedAt:serviceAct.performedAt,
      anatomicalRegionsCount:serviceAct.anatomicalRegionsCount,
      radiologistEmail:serviceAct.radiologistEmail,
      radiographerEmail:serviceAct.radiographerEmail,
    },
  };
}

async function serviceActContext(request:Request) {
  const db=dbBinding();
  if(!db) return {response:Response.json({error:"База тимчасово недоступна"},{status:503})} as const;
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return {response:Response.json({error:"Доступ лише для персоналу"},{status:403})} as const;
  if(!canManageFinance(ctx.member.role)) {
    return {response:Response.json({error:"Друк актів доступний реєстратору або адміністратору"},{status:403})} as const;
  }
  return {db,ctx} as const;
}

export async function GET(request:Request) {
  const auth=await serviceActContext(request);
  if("response" in auth) return auth.response;
  const {db,ctx}=auth;
  const snapshotId=int(new URL(request.url).searchParams.get("snapshotId"));
  if(!snapshotId) return Response.json({error:"Некоректна друкована форма"},{status:400});
  const row=await db.prepare(
    `SELECT s.id,s.document_id AS documentId,s.form_type AS formType,s.template_version AS templateVersion,
            s.document_state AS documentState,s.payload_json AS payloadJson,s.generated_by AS generatedBy,
            s.generated_at AS generatedAt,s.storage_key AS storageKey,s.sha256
     FROM printed_form_snapshots s
     JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
     JOIN service_delivery_details a ON a.document_id=d.id AND a.organization_id=d.organization_id
     WHERE s.organization_id=? AND s.id=? AND s.form_type=? AND d.document_type='service_delivery' LIMIT 1`
  ).bind(ctx.organizationId,snapshotId,FORM_TYPE).first<SnapshotRow>();
  if(!row) return Response.json({error:"Друковану форму не знайдено"},{status:404});
  return Response.json({snapshot:publicSnapshot(row),payload:JSON.parse(row.payloadJson)});
}

export async function POST(request:Request) {
  const auth=await serviceActContext(request);
  if("response" in auth) return auth.response;
  const {db,ctx}=auth;
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const documentId=int(body.documentId);
  if(!documentId) return Response.json({error:"Некоректний документ"},{status:400});

  const serviceAct=await getServiceDeliveryDocument(db,ctx.organizationId,documentId);
  if(!serviceAct) return Response.json({error:"Акт надання послуг не знайдено"},{status:404});
  const documentState=serviceAct.state;

  const existing=await db.prepare(
    `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
            document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
            generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots
     WHERE organization_id=? AND document_id=? AND form_type=? AND template_version=? AND document_state=?
     ORDER BY id ASC LIMIT 1`
  ).bind(ctx.organizationId,documentId,FORM_TYPE,TEMPLATE_VERSION,documentState).first<SnapshotRow>();
  if(existing) {
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:"printed_form_reprinted",resource:"business_document",targetId:documentId,
      details:{formType:FORM_TYPE,templateVersion:TEMPLATE_VERSION,snapshotId:existing.id},
    });
    return Response.json({snapshot:publicSnapshot(existing),payload:JSON.parse(existing.payloadJson)});
  }

  const payload=await renderPayload(db,ctx.organizationId,documentId);
  if(!payload) return Response.json({error:"Акт надання послуг не знайдено"},{status:404});
  const payloadJson=JSON.stringify(payload);
  const hash=await sha256(payloadJson);
  await db.prepare(
    `INSERT OR IGNORE INTO printed_form_snapshots
      (organization_id,document_id,form_type,template_version,document_state,payload_json,generated_by,sha256)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    ctx.organizationId,documentId,FORM_TYPE,TEMPLATE_VERSION,documentState,payloadJson,ctx.member.email,hash,
  ).run();
  const snapshot=await db.prepare(
    `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
            document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
            generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots
     WHERE organization_id=? AND document_id=? AND form_type=? AND template_version=? AND document_state=? AND sha256=?
     LIMIT 1`
  ).bind(
    ctx.organizationId,documentId,FORM_TYPE,TEMPLATE_VERSION,documentState,hash,
  ).first<SnapshotRow>();
  if(!snapshot) return Response.json({error:"Не вдалося зберегти друкований акт"},{status:500});
  await audit(db,{
    organizationId:ctx.organizationId,actorEmail:ctx.member.email,
    action:"printed_form_generated",resource:"business_document",targetId:documentId,
    details:{formType:FORM_TYPE,templateVersion:TEMPLATE_VERSION,snapshotId:snapshot.id},
  });
  return Response.json({snapshot:publicSnapshot(snapshot),payload},{status:201});
}
