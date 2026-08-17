import {asArray,asObject,detail,documentHeader,escapeHtml,formatDate,meta,type RenderObject} from "./common.ts";

export function renderInventoryPrintedForm(payload:RenderObject){
  const doc=asObject(payload.document);
  const title=payload.formType==="inventory_writeoff"?"Списання матеріалів":"Надходження матеріалів";
  const lines=asArray(payload.lines).map(raw=>{
    const l=asObject(raw);
    const quantity=Number(l.quantity||0).toLocaleString("uk-UA",{maximumFractionDigits:2});
    const warehouse=`${escapeHtml(l.warehouseName||"—")}${l.warehouseCode?`<br><small>${escapeHtml(l.warehouseCode)}</small>`:""}`;
    const lot=`${escapeHtml(l.lotNumber||"—")}${l.expiresOn?`<br><small>до ${escapeHtml(l.expiresOn)}</small>`:""}`;
    const reason=`${escapeHtml(l.reason||"—")}${l.bookingId?`<br><small>дослідження #${escapeHtml(l.bookingId)}</small>`:""}`;
    return `<tr><td>${escapeHtml(l.lineNo)}</td><td>${warehouse}</td><td><b>${escapeHtml(l.itemName||"—")}</b></td><td>${lot}</td><td>${escapeHtml(l.supplier||"—")}</td><td>${escapeHtml(quantity)} ${escapeHtml(l.unit)}</td><td>${reason}</td></tr>`;
  }).join("");
  return `${documentHeader(payload,title)}<section class="grid">${meta("Номер",doc.number)}${meta("Дата",formatDate(doc.occurredAt))}${meta("Створив",doc.createdBy)}${meta("Стан",doc.state)}${doc.postedBy?meta("Провів",doc.postedBy)+meta("Проведено",formatDate(doc.postedAt)):""}</section>${doc.comment?`<section class="rows">${detail("Примітка",doc.comment)}</section>`:""}<table><thead><tr><th>№</th><th>Склад</th><th>Матеріал</th><th>Партія / термін</th><th>Постачальник</th><th>Кількість</th><th>Підстава</th></tr></thead><tbody>${lines}</tbody></table>`;
}
