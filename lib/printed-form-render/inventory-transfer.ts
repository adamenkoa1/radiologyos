import {asArray,asObject,detail,documentHeader,escapeHtml,formatDate,meta,type RenderObject} from "./common.ts";

function quantity(value:unknown){
  const n=Number(value||0);
  return Number.isFinite(n)?n.toLocaleString("uk-UA",{maximumFractionDigits:3}):"0";
}
function warehouse(name:unknown,code:unknown){
  return `${escapeHtml(name||"—")}${code?`<br><small>${escapeHtml(code)}</small>`:""}`;
}

export function renderInventoryTransferPrintedForm(payload:RenderObject){
  const doc=asObject(payload.document);
  const lines=asArray(payload.lines).map(raw=>{
    const line=asObject(raw);
    const lot=`${escapeHtml(line.lotNumber||"—")}${line.expiresOn?`<br><small>до ${escapeHtml(line.expiresOn)}</small>`:""}`;
    return `<tr><td>${escapeHtml(line.lineNo)}</td><td>${warehouse(line.sourceWarehouseName,line.sourceWarehouseCode)}</td><td>${warehouse(line.destinationWarehouseName,line.destinationWarehouseCode)}</td><td><b>${escapeHtml(line.itemName||"—")}</b><br><small>${escapeHtml(line.unit||"")}</small></td><td>${lot}</td><td>${escapeHtml(quantity(line.quantity))}</td><td>${escapeHtml(line.reason||"—")}</td></tr>`;
  }).join("");
  return `${documentHeader(payload,"Переміщення запасів")}<section class="grid">${meta("Номер",doc.number)}${meta("Дата",formatDate(doc.occurredAt))}${meta("Створив",doc.createdBy)}${meta("Стан",doc.state)}${doc.postedBy?meta("Провів",doc.postedBy)+meta("Проведено",formatDate(doc.postedAt)):""}</section>${doc.comment?`<section class="rows">${detail("Примітка",doc.comment)}</section>`:""}<table><thead><tr><th>№</th><th>Склад-відправник</th><th>Склад-одержувач</th><th>Матеріал / од.</th><th>Партія / термін</th><th>Кількість</th><th>Підстава</th></tr></thead><tbody>${lines}</tbody></table>`;
}
