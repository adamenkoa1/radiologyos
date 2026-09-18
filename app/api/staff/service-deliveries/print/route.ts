import { audit } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import { printedFormStorageKey } from "../../../../../lib/printed-form-storage-key";
import { canManageFinance } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

const TEMPLATE_VERSION=1;
const FORM_TYPE="service_act";

type SnapshotRow={
  id:number;documentId:number;formType:string;templateVersion:number;documentState:string;
  payloadJson:string;generatedBy:string;generatedAt:string;storageKey:string;sha256:string;
};

type ServiceActSource={
  documentId:number;documentNumber:string;occurredAt:string;documentState:string;comment:string;
  createdBy:string;createdAt:string;postedBy:string;postedAt:string;
  bookingId:number;bookingCode:string;patientName:string;patientId:string;patientCategory:string;
  serviceCode:string;serviceTitle:string;equipmentId:string;durationMinutes:number;anatomicalRegionsCount:number;
  performedAt:string;radiologistEmail:string;radiographerEmail:string;priceAmount:number;chargeAmount:number;currency:string;
  organizationName:string;
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

async function sourceForDocument(db:D1Database,organizationId:number,documentId:number) {
  const row=await db.prepare(
    `SELECT d.id AS documentId,d.number AS documentNumber,d.occurred_at AS occurredAt,
            d.state AS documentState,d.comment,d.created_by AS createdBy,d.created_at AS createdAt,
            d.posted_by AS postedBy,d.posted_at AS postedAt,
            s.booking_id AS bookingId,b.code AS bookingCode,b.name AS patientName,
            s.patient_id AS patientId,s.patient_category AS patientCategory,
            s.service_code AS serviceCode,s.service_title AS serviceTitle,s.equipment_id AS equipmentId,
            s.duration_minutes AS durationMinutes,s.anatomical_regions_count AS anatomicalRegionsCount,
            s.performed_at AS performedAt,s.radiologist_email AS radiologistEmail,
            s.radiographer_email AS radiographerEmail,s.price_amount AS priceAmount,
            s.charge_amount AS chargeAmount,s.currency,
            COALESCE(o.name,'Організація') AS organizationName
     FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     JOIN bookings b ON b.id=s.booking_id AND b.organization_id=s.organization_id
     LEFT JOIN organizations o ON o.id=d.organization_id
     WHERE d.organization_id=? AND d.id=? AND d.document_type='service_delivery'
     LIMIT 1`
  ).bind(organizationId,documentId).first<ServiceActSource>();
  return row || null;
}

function renderPayload(source:ServiceActSource) {
  return {
    templateVersion:TEMPLATE_VERSION,
    formType:FORM_TYPE,
    organization:{name:source.organizationName || "Організація"},
    document:{
      id:source.documentId,
      number:source.documentNumber,
      occurredAt:source.occurredAt,
      state:source.documentState,
      comment:source.comment,
      createdBy:source.createdBy,
      createdAt:source.createdAt,
      postedBy:source.postedBy,
      postedAt:source.postedAt,
    },
    booking:{
      id:source.bookingId,
      code:source.bookingCode,
      patientName:source.patientName,
      patientId:source.patientId,
      patientCategory:source.patientCategory,
    },
    service:{
      code:source.serviceCode,
      title:source.serviceTitle,
      equipmentId:source.equipmentId,
      durationMinutes:source.durationMinutes,
      anatomicalRegionsCount:source.anatomicalRegionsCount,
      performedAt:source.performedAt,
      radiologistEmail:source.radiologistEmail,
      radiographerEmail:source.radiographerEmail,
      priceAmount:source.priceAmount,
      chargeAmount:source.chargeAmount,
      currency:source.currency,
    },
  };
}

async function serviceActContext(request:Request) {
  const db=dbBinding();
  if(!db) return {response:Response.json({error:"База тимчасово недоступна"},{status:503})} as const;
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return {response:Response.json({error:"Доступ лише для персоналу"},{status:403})} as const;
  if(!canManageFinance(ctx.member.role)) {
    return {response:Response.json({error:"Акти наданих послуг доступні реєстратору або адміністратору"},{status:403})} as const;
  }
  return {db,ctx} as const;
}

export async function GET(request:Request) {
  const auth=await serviceActContext(request);
  if("response" in auth) return auth.response;
  const {db,ctx}=auth;
  const url=new URL(request.url);
  const snapshotId=int(url.searchParams.get("snapshotId"));
  if(!snapshotId) return Response.json({error:"Некоректна друкована форма"},{status:400});
  const row=await db.prepare(
    `SELECT s.id,s.document_id AS documentId,s.form_type AS formType,s.template_version AS templateVersion,
            s.document_state AS documentState,s.payload_json AS payloadJson,s.generated_by AS generatedBy,
            s.generated_at AS generatedAt,s.storage_key AS storageKey,s.sha256
     FROM printed_form_snapshots s
     JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
     WHERE s.organization_id=? AND s.id=? AND s.form_type=? AND d.document_type='service_delivery'
     LIMIT 1`
  ).bind(ctx.organizationId,snapshotId,FORM_TYPE).first<SnapshotRow>();
  if(!row) return Response.json({error:"Акт наданих послуг не знайдено"},{status:404});
  return Response.json({snapshot:publicSnapshot(row),payload:JSON.parse(row.payloadJson)});
}

export async function POST(request:Request) {
  const auth=await serviceActContext(request);
  if("response" in auth) return auth.response;
  const {db,ctx}=auth;
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const documentId=int(body.documentId);
  if(!documentId) return Response.json({error:"Некоректний документ"},{status:400});

  const source=await sourceForDocument(db,ctx.organizationId,documentId);
  if(!source) return Response.json({error:"Документ надання послуги не знайдено"},{status:404});
  if(source.documentState!=="posted" && source.documentState!=="reversed") {
    return Response.json({error:"Акт формується лише для проведеного або сторнованого документа"},{status:409});
  }

  const existing=await db.prepare(
    `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
            document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
            generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots
     WHERE organization_id=? AND document_id=? AND form_type=? AND template_version=? AND document_state=?
     ORDER BY id ASC LIMIT 1`
  ).bind(ctx.organizationId,documentId,FORM_TYPE,TEMPLATE_VERSION,source.documentState).first<SnapshotRow>();
  if(existing) {
    await audit(db,{
      organizationId:ctx.organizationId,actorEmail:ctx.member.email,
      action:"printed_form_reprinted",resource:"business_document",targetId:documentId,
      details:{formType:FORM_TYPE,templateVersion:TEMPLATE_VERSION,snapshotId:existing.id},
    });
    return Response.json({snapshot:publicSnapshot(existing),payload:JSON.parse(existing.payloadJson)});
  }

  const payload=renderPayload(source);
  const payloadJson=JSON.stringify(payload);
  const hash=await sha256(payloadJson);
  const storageKey=printedFormStorageKey({
    organizationId:ctx.organizationId,documentId,formType:FORM_TYPE,
    templateVersion:TEMPLATE_VERSION,documentState:source.documentState,sha256:hash,
  });
  const inserted=await db.prepare(
    `INSERT OR IGNORE INTO printed_form_snapshots
      (organization_id,document_id,form_type,template_version,document_state,payload_json,generated_by,storage_key,sha256)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    ctx.organizationId,documentId,FORM_TYPE,TEMPLATE_VERSION,source.documentState,payloadJson,ctx.member.email,storageKey,hash,
  ).run();
  const snapshot=await db.prepare(
    `SELECT id,document_id AS documentId,form_type AS formType,template_version AS templateVersion,
            document_state AS documentState,payload_json AS payloadJson,generated_by AS generatedBy,
            generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots
     WHERE organization_id=? AND document_id=? AND form_type=? AND template_version=? AND document_state=?
     ORDER BY id ASC LIMIT 1`
  ).bind(ctx.organizationId,documentId,FORM_TYPE,TEMPLATE_VERSION,source.documentState).first<SnapshotRow>();
  if(!snapshot) return Response.json({error:"Не вдалося зберегти акт наданих послуг"},{status:500});

  const created=Number(inserted.meta.changes || 0)>0;
  await audit(db,{
    organizationId:ctx.organizationId,actorEmail:ctx.member.email,
    action:created?"printed_form_generated":"printed_form_reprinted",
    resource:"business_document",targetId:documentId,
    details:{formType:FORM_TYPE,templateVersion:TEMPLATE_VERSION,snapshotId:snapshot.id},
  });
  return Response.json(
    {snapshot:publicSnapshot(snapshot),payload:JSON.parse(snapshot.payloadJson)},
    {status:created?201:200},
  );
}
