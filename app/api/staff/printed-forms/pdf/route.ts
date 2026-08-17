import {audit} from "../../../../../lib/audit";
import {dbBinding} from "../../../../../lib/db";
import {PrintedFormArtifactError,type PrintedFormArtifactSnapshot} from "../../../../../lib/printed-form-artifact-types";
import {materializePrintedFormPdf} from "../../../../../lib/printed-form-pdf";
import {canManageFinance} from "../../../../../lib/staff-auth";
import {requireOrgContext} from "../../../../../lib/tenant";
type Row=PrintedFormArtifactSnapshot&{documentType:string};
const int=(v:unknown)=>{const n=Number(v);return Number.isInteger(n)&&n>0?n:null;};
function allowed(row:Row,role:string){if(row.formType==="inventory_receipt"||row.formType==="inventory_writeoff")return row.documentType===row.formType;if(row.formType==="payment_receipt")return canManageFinance(role as Parameters<typeof canManageFinance>[0])&&(row.documentType==="payment"||row.documentType==="refund");if(row.formType==="service_act")return canManageFinance(role as Parameters<typeof canManageFinance>[0])&&row.documentType==="service_delivery";return false;}
export async function GET(request:Request){
 const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
 const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
 const snapshotId=int(new URL(request.url).searchParams.get("snapshotId"));if(!snapshotId)return Response.json({error:"Некоректна друкована форма"},{status:400});
 const row=await db.prepare(`SELECT s.id,s.organization_id AS organizationId,s.document_id AS documentId,s.form_type AS formType,s.template_version AS templateVersion,s.document_state AS documentState,s.payload_json AS payloadJson,s.storage_key AS storageKey,s.sha256,d.document_type AS documentType FROM printed_form_snapshots s JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id WHERE s.organization_id=? AND s.id=? LIMIT 1`).bind(ctx.organizationId,snapshotId).first<Row>();
 if(!row||!allowed(row,ctx.member.role))return Response.json({error:"Друковану форму не знайдено"},{status:404});
 let payload:unknown;try{payload=JSON.parse(row.payloadJson);}catch{await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"printed_form_pdf_failed",resource:"business_document",targetId:row.documentId,details:{snapshotId:row.id,formType:row.formType,code:"invalid_snapshot"}});return Response.json({error:"Друкована форма пошкоджена"},{status:500});}
 try{
  const artifact=await materializePrintedFormPdf(row,payload);
  if(artifact.created)await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"printed_form_pdf_materialized",resource:"business_document",targetId:row.documentId,details:{snapshotId:row.id,formType:row.formType}});
  await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"printed_form_pdf_downloaded",resource:"business_document",targetId:row.documentId,details:{snapshotId:row.id,formType:row.formType}});
  return new Response(artifact.bytes,{headers:{"content-type":"application/pdf","content-disposition":`attachment; filename="${row.formType}-${row.documentId}-snapshot-${row.id}.pdf"`,"cache-control":"private, no-store","etag":artifact.etag,"x-content-sha256":artifact.binarySha256}});
 }catch(error){const code=error instanceof PrintedFormArtifactError?error.code:"render_failed";await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"printed_form_pdf_failed",resource:"business_document",targetId:row.documentId,details:{snapshotId:row.id,formType:row.formType,code}});return Response.json({error:code==="integrity_failed"?"Порушено цілісність збереженої PDF-форми":"PDF тимчасово недоступний"},{status:code==="integrity_failed"?500:503});}
}
