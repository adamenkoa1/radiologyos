export type PrintedFormStorageIdentity={organizationId:number;documentId:number;formType:string;templateVersion:number;documentState:string;sha256:string};
const FORMS=new Set(["inventory_receipt","inventory_writeoff","inventory_count","payment_receipt","service_act"]);
const SHA=/^[a-f0-9]{64}$/;
function state(value:string){const v=String(value||"unknown").trim().toLowerCase();return /^[a-z0-9_-]{1,32}$/.test(v)?v:"unknown";}
export function printedFormStorageKey(s:PrintedFormStorageIdentity){
 if(!Number.isInteger(s.organizationId)||s.organizationId<1)throw new Error("invalid_printed_form_organization");
 if(!Number.isInteger(s.documentId)||s.documentId<1)throw new Error("invalid_printed_form_document");
 if(!Number.isInteger(s.templateVersion)||s.templateVersion<1)throw new Error("invalid_printed_form_template");
 if(!FORMS.has(s.formType))throw new Error("invalid_printed_form_type");
 if(!SHA.test(s.sha256))throw new Error("invalid_printed_form_hash");
 return `organizations/${s.organizationId}/printed-forms/${s.documentId}/${s.formType}/${state(s.documentState)}/v${s.templateVersion}/${s.sha256}.pdf`;
}
export function printedFormState(value:string){return state(value);}
