import {asObject,detail,documentHeader,escapeHtml,formatDate,formatMoney,meta,type RenderObject} from "./common.ts";
export function renderPaymentPrintedForm(payload:RenderObject){
 const doc=asObject(payload.document),booking=asObject(payload.booking),pay=asObject(payload.payment),cash=asObject(payload.cashAccount),source=asObject(payload.sourceDocument);
 const refund=doc.documentType==="refund";
 const methods:Record<string,string>={cash:"Готівка",card:"Картка",bank_transfer:"Банківський переказ",privat_link:"Privat24",other:"Інше"};
 const cashLabel=Object.keys(cash).length?`${String(cash.name||"")}${cash.code?` · ${String(cash.code)}`:""}`:"Legacy / не визначено";
 return `${documentHeader(payload,refund?"Квитанція про повернення":"Квитанція про оплату")}<section class="grid">${meta("Номер",doc.number)}${meta("Дата",formatDate(doc.occurredAt))}${meta("Заявка",booking.code)}${meta("Пацієнт",booking.patientName)}${meta("Послуга",booking.service)}${meta("Спосіб",methods[String(pay.method||"")]||pay.method||pay.provider)}${meta("Каса / рахунок",cashLabel)}</section><section class="amount ${refund?"refund":""}"><span>${refund?"Повернено":"Отримано"}</span><b>${escapeHtml(formatMoney(pay.amount,pay.currency))}</b></section><section class="rows">${detail("Провайдер",pay.provider||"manual")}${detail("Платіжний референс",pay.providerReference)}${Object.keys(source).length?detail("Документ-підстава",source.number):""}${doc.comment?detail("Примітка",doc.comment):""}${detail("Відповідальний",doc.postedBy||doc.createdBy)}</section>`;
}
