import {asArray,asObject,detail,documentHeader,escapeHtml,formatDate,meta,type RenderObject} from "./common.ts";

function quantity(value:unknown){
  const n=Number(value||0);
  return Number.isFinite(n)?n.toLocaleString("uk-UA",{maximumFractionDigits:3}):"0";
}
function discrepancy(value:unknown){
  const n=Number(value||0);
  if(!Number.isFinite(n))return"0";
  const text=Math.abs(n).toLocaleString("uk-UA",{maximumFractionDigits:3});
  return n>0?`+${text}`:n<0?`−${text}`:"0";
}

export function renderInventoryCountPrintedForm(payload:RenderObject){
  const doc=asObject(payload.document);
  const lines=asArray(payload.lines).map(raw=>{
    const line=asObject(raw);
    const warehouse=`${escapeHtml(line.warehouseName||"—")}${line.warehouseCode?`<br><small>${escapeHtml(line.warehouseCode)}</small>`:""}`;
    const lot=escapeHtml(line.lotNumber||"—");
    return `<tr><td>${escapeHtml(line.lineNo)}</td><td>${warehouse}</td><td><b>${escapeHtml(line.itemName||"—")}</b><br><small>${escapeHtml(line.unit||"")}</small></td><td>${lot}</td><td>${escapeHtml(quantity(line.bookQuantity))}</td><td>${escapeHtml(quantity(line.countedQuantity))}</td><td><b>${escapeHtml(discrepancy(line.discrepancyQuantity))}</b></td><td>${escapeHtml(line.reason||"—")}</td></tr>`;
  }).join("");
  return `${documentHeader(payload,"Інвентаризація запасів")}<section class="grid">${meta("Номер",doc.number)}${meta("Дата",formatDate(doc.occurredAt))}${meta("Створив",doc.createdBy)}${meta("Стан",doc.state)}${doc.postedBy?meta("Провів",doc.postedBy)+meta("Проведено",formatDate(doc.postedAt)):""}</section>${doc.comment?`<section class="rows">${detail("Примітка",doc.comment)}</section>`:""}<table><thead><tr><th>№</th><th>Склад</th><th>Матеріал / од.</th><th>Партія</th><th>Облік</th><th>Факт</th><th>Δ</th><th>Причина</th></tr></thead><tbody>${lines}</tbody></table>`;
}
