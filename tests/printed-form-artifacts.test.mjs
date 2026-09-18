import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PrintedFormArtifactError} from "../lib/printed-form-artifact-types.ts";
import {materializePrintedFormPdf} from "../lib/printed-form-pdf.ts";
import {renderPrintedFormHtml} from "../lib/printed-form-render/index.ts";
import {printedFormStorageKey} from "../lib/printed-form-storage-key.ts";

const encoder=new TextEncoder();
const PDF=encoder.encode("%PDF-1.7\nmock immutable pdf\n%%EOF");
const HASH="a".repeat(64);
const snapshot=(organizationId=1)=>({id:7,organizationId,documentId:44,formType:"payment_receipt",templateVersion:2,documentState:"posted",payloadJson:"{}",storageKey:"",sha256:HASH});
const payload={formType:"payment_receipt",organization:{name:"Hospital"},document:{number:"PAY-1",documentType:"payment",occurredAt:"2026-08-17T10:00:00Z",state:"posted",comment:"",createdBy:"admin@example.com",postedBy:"admin@example.com"},booking:{code:"B-1",patientName:"<script>alert(1)</script>",service:"CT"},payment:{amount:1000,currency:"UAH",method:"cash",provider:"manual",providerReference:""},cashAccount:null,sourceDocument:null};
const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

class FakeBucket{
  objects=new Map();
  async head(key){const v=this.objects.get(key);return v?{size:v.bytes.length,httpEtag:v.httpEtag,httpMetadata:v.httpMetadata,customMetadata:v.customMetadata}:null;}
  async get(key){const v=this.objects.get(key);return v?{size:v.bytes.length,httpEtag:v.httpEtag,httpMetadata:v.httpMetadata,customMetadata:v.customMetadata,body:new Blob([v.bytes]).stream()}:null;}
  async put(key,value,options={}){if(this.objects.has(key))return null;const bytes=value instanceof Uint8Array?new Uint8Array(value):new Uint8Array(await new Response(value).arrayBuffer());const stored={bytes,httpEtag:`etag-${this.objects.size+1}`,httpMetadata:options.httpMetadata||{},customMetadata:options.customMetadata||{}};this.objects.set(key,stored);return {size:bytes.length,httpEtag:stored.httpEtag,httpMetadata:stored.httpMetadata,customMetadata:stored.customMetadata};}
}
function installRuntime(bucket,browser){globalThis.__RADIOLOGY_PRINTED_FORMS__=bucket;globalThis.__RADIOLOGY_BROWSER_RUN__=browser;}
function clearRuntime(){delete globalThis.__RADIOLOGY_PRINTED_FORMS__;delete globalThis.__RADIOLOGY_BROWSER_RUN__;}

test("printed-form storage keys are deterministic and tenant-separated",()=>{const one=printedFormStorageKey(snapshot(1)),same=printedFormStorageKey(snapshot(1)),two=printedFormStorageKey(snapshot(2));assert.equal(one,same);assert.notEqual(one,two);assert.match(one,/^organizations\/1\/printed-forms\/44\/payment_receipt\/posted\/v2\/[a-f0-9]{64}\.pdf$/);});

test("server PDF HTML is sourced from snapshot payload and escapes patient content",()=>{const html=renderPrintedFormHtml(snapshot(1),payload);assert.match(html,/Квитанція про оплату/);assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);assert.match(html,/snapshot #7/);});

test("R2 materialization is immutable and Browser Run is not repeated",async()=>{const bucket=new FakeBucket();let browserCalls=0;installRuntime(bucket,{quickAction:async(action,input)=>{browserCalls++;assert.equal(action,"pdf");assert.match(String(input.html),/PAY-1/);return new Response(PDF,{status:200,headers:{"content-type":"application/pdf"}});}});try{const first=await materializePrintedFormPdf(snapshot(1),payload),second=await materializePrintedFormPdf(snapshot(1),payload);assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(browserCalls,1);assert.equal(first.key,second.key);assert.deepEqual(Array.from(second.bytes),Array.from(PDF));assert.equal(bucket.objects.size,1);}finally{clearRuntime();}});

test("stored PDF metadata mismatch fails closed instead of regenerating or overwriting",async()=>{const bucket=new FakeBucket();let browserCalls=0;installRuntime(bucket,{quickAction:async()=>{browserCalls++;return new Response(PDF,{headers:{"content-type":"application/pdf"}});}});try{const first=await materializePrintedFormPdf(snapshot(1),payload),stored=bucket.objects.get(first.key);stored.customMetadata={...stored.customMetadata,organizationId:"999"};await assert.rejects(()=>materializePrintedFormPdf(snapshot(1),payload),error=>error instanceof PrintedFormArtifactError&&error.code==="integrity_failed");assert.equal(browserCalls,1);assert.equal(bucket.objects.size,1);}finally{clearRuntime();}});

test("binary retrieval is tenant-scoped, RBAC-aware and never accepts client PDF bytes",async()=>{const source=await read("app/api/staff/printed-forms/pdf/route.ts");assert.match(source,/requireOrgContext\(request,db\)/);assert.match(source,/WHERE s\.organization_id=\? AND s\.id=\?/);assert.match(source,/canManageFinance/);assert.match(source,/materializePrintedFormPdf\(row,payload\)/);assert.doesNotMatch(source,/request\.arrayBuffer\(/);assert.doesNotMatch(source,/request\.blob\(/);});

test("new business snapshots reserve canonical storage keys without a D1 schema change",async()=>{for(const path of ["app/api/staff/finance/print/route.ts","app/api/staff/inventory/documents/print/route.ts","app/api/staff/service-deliveries/print/route.ts"]){const source=await read(path);assert.match(source,/printedFormStorageKey/);assert.match(source,/storage_key,sha256/);assert.match(source,/storageKey,hash/);}});

test("Cloudflare config binds Browser Run and a private R2 bucket at the Quick Actions compatibility floor",async()=>{const config=await read("wrangler.cloudflare.toml");assert.match(config,/compatibility_date\s*=\s*"2026-03-24"/);assert.match(config,/\[browser\]\s*\nbinding\s*=\s*"BROWSER"/);assert.match(config,/\[\[r2_buckets\]\][\s\S]*binding\s*=\s*"PRINTED_FORMS"[\s\S]*bucket_name\s*=\s*"radiologyos-printed-forms"/);});

test("production and local deploys fail before D1 mutation when printed-form R2 is missing",async()=>{const [workflow,script]=await Promise.all([read(".github/workflows/deploy.yml"),read("scripts/deploy-cloudflare.sh")]);for(const source of [workflow,script]){const preflight=source.indexOf("wrangler r2 bucket info radiologyos-printed-forms"),recovery=source.indexOf("wrangler d1 time-travel info radiologyos"),migrate=source.indexOf("apply-d1-migrations-remote.sh radiologyos");assert.notEqual(preflight,-1);assert.notEqual(recovery,-1);assert.notEqual(migrate,-1);assert.ok(preflight<recovery&&preflight<migrate,"R2 preflight must happen before D1 recovery/migration steps");}});
