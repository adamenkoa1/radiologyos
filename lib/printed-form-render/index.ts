import {asObject,escapeHtml,PRINT_CSS,type PrintedFormRenderSnapshot} from "./common.ts";
import {renderInventoryPrintedForm} from "./inventory.ts";
import {renderPaymentPrintedForm} from "./payment.ts";
import {renderServiceActPrintedForm} from "./service-act.ts";
export type {PrintedFormRenderSnapshot} from "./common.ts";
export function renderPrintedFormHtml(s:PrintedFormRenderSnapshot,payload:unknown){
 const p=asObject(payload);let body="";
 if(s.formType==="inventory_receipt"||s.formType==="inventory_writeoff")body=renderInventoryPrintedForm(p);
 else if(s.formType==="payment_receipt")body=renderPaymentPrintedForm(p);
 else if(s.formType==="service_act")body=renderServiceActPrintedForm(p);
 if(!body)throw new Error("unsupported_printed_form");
 const footer=`Форма v${s.templateVersion} · snapshot #${s.id} · SHA-256 ${s.sha256.slice(0,12)}…`;
 return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${body}<p class="footer">${escapeHtml(footer)}</p></body></html>`;
}
