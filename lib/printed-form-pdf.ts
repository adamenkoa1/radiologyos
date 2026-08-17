import {PrintedFormArtifactError,type PrintedFormArtifactSnapshot,type PrintedFormPdfArtifact} from "./printed-form-artifact-types";
import {isPdfBytes,objectMetadata,readStoredPrintedFormPdf,sha256Bytes} from "./printed-form-object";
import {renderPrintedFormHtml} from "./printed-form-render";
import {printedFormStorageKey} from "./printed-form-storage-key";
import {browserRunBinding,printedFormsBucketBinding} from "./printed-form-runtime";
export async function materializePrintedFormPdf(s:PrintedFormArtifactSnapshot,payload:unknown):Promise<PrintedFormPdfArtifact>{
 const key=printedFormStorageKey(s);if(s.storageKey&&s.storageKey!==key)throw new PrintedFormArtifactError("integrity_failed","Snapshot storage key does not match canonical identity");
 const bucket=printedFormsBucketBinding();if(!bucket)throw new PrintedFormArtifactError("runtime_unavailable","Printed-form object storage is not configured");
 const existing=await readStoredPrintedFormPdf(bucket,key,s);if(existing)return existing;
 const browser=browserRunBinding();if(!browser)throw new PrintedFormArtifactError("runtime_unavailable","Browser Run is not configured");
 let response:Response;try{response=await browser.quickAction("pdf",{html:renderPrintedFormHtml(s,payload),pdfOptions:{format:"a4",landscape:false,printBackground:true,preferCSSPageSize:true,margin:{top:"12mm",right:"12mm",bottom:"12mm",left:"12mm"}}});}catch{throw new PrintedFormArtifactError("render_failed","Browser Run could not render the PDF");}
 if(!response.ok||!(response.headers.get("content-type")||"").toLowerCase().startsWith("application/pdf"))throw new PrintedFormArtifactError("render_failed","Browser Run returned a non-PDF response");
 const bytes=new Uint8Array(await response.arrayBuffer());if(!isPdfBytes(bytes))throw new PrintedFormArtifactError("invalid_pdf","Browser Run returned invalid PDF bytes");
 const binary=await sha256Bytes(bytes),filename=`${s.formType}-${s.documentId}-snapshot-${s.id}.pdf`;
 const stored=await bucket.put(key,bytes,{onlyIf:new Headers({"if-none-match":"*"}),httpMetadata:{contentType:"application/pdf",contentDisposition:`attachment; filename="${filename}"`,cacheControl:"private, no-store"},customMetadata:objectMetadata(s,binary.hex),sha256:binary.digest});
 if(!stored){const raced=await readStoredPrintedFormPdf(bucket,key,s);if(!raced)throw new PrintedFormArtifactError("integrity_failed","Concurrent PDF materialization did not produce a readable object");return raced;}
 return {key,bytes,binarySha256:binary.hex,etag:stored.httpEtag,created:true};
}
