"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type DocumentRow={
  id:number;documentType:string;journalType:string;number:string;occurredAt:string;state:string;comment:string;
  createdBy:string;createdAt:string;postedBy:string;postedAt:string;reversedDocumentId:number|null;
  bookingId:number|null;bookingCode:string;patientName:string;patientId:string;subject:string;
  amount:number;currency:string;sourceDocumentId:number|null;relationType:string;lineCount:number;totalQuantity:number;
};
type Related={id:number;documentType:string;journalType:string;number:string;occurredAt:string;state:string;relationType:string};
type Detail={
  document:DocumentRow;
  relations:{parent:Related[];children:Related[]};
  movements:Record<string,Array<Record<string,unknown>>>;
  printedForms:Array<{id:number;formType:string;templateVersion:number;documentState:string;generatedBy:string;generatedAt:string;sha256:string}>;
  error?:string;
};
type ListPayload={documents:DocumentRow[];error?:string};

const TYPE_UK:Record<string,string>={
  patient_order:"Замовлення пацієнта",appointment:"Запис",service_delivery:"Надання послуги",
  service_correction:"Сторно послуги",payment:"Оплата",refund:"Повернення",
  inventory_receipt:"Надходження на склад",inventory_writeoff:"Списання зі складу",
  inventory_transfer:"Переміщення складу",inventory_count:"Інвентаризація",
  study_performance:"Виконання дослідження",study_correction:"Сторно дослідження",result_delivery:"Видача результату",result_addendum_delivery:"Видача виправлення",
};
const STATE_UK:Record<string,string>={draft:"Чернетка",posted:"Проведено",reversed:"Сторновано",cancelled:"Скасовано"};
const REL_UK:Record<string,string>={based_on:"На підставі",storno_of:"Сторно документа",refund_of:"Повернення за оплатою",reversal_of:"Сторно/реверс",storno:"Документ сторно",refund:"Документ повернення",reversal:"Реверс",source:"Підстава",related:"Пов’язаний"};
const REGISTER_UK:Record<string,string>={
  cash:"Гроші",settlement:"Взаєморозрахунки",revenue:"Дохід",services:"Надані послуги",
  corrections:"Корекції послуг",equipment:"Навантаження обладнання",staff:"Виробіток персоналу",inventory:"Склад",
};

function dateTime(value:string) {
  const d=new Date(value);
  return Number.isNaN(d.getTime())?value:d.toLocaleString("uk-UA",{dateStyle:"medium",timeStyle:"short"});
}
function money(value:number,currency="UAH") {
  return new Intl.NumberFormat("uk-UA",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value||0));
}
function describeMovement(row:Record<string,unknown>) {
  const parts:string[]=[];
  if(row.movementType)parts.push(String(row.movementType));
  if(typeof row.amountDelta==="number")parts.push(`${row.amountDelta>0?"+":""}${money(row.amountDelta,String(row.currency||"UAH"))}`);
  if(typeof row.quantityDelta==="number")parts.push(`кількість ${row.quantityDelta>0?"+":""}${row.quantityDelta}`);
  if(typeof row.quantity==="number")parts.push(`кількість ${row.quantity}`);
  if(typeof row.minutesDelta==="number")parts.push(`${row.minutesDelta>0?"+":""}${row.minutesDelta} хв`);
  if(typeof row.unitsDelta==="number")parts.push(`одиниць ${row.unitsDelta>0?"+":""}${row.unitsDelta}`);
  if(row.serviceCode)parts.push(String(row.serviceCode));
  if(row.itemName)parts.push(String(row.itemName));
  if(row.memberEmail)parts.push(`${row.staffRole||"staff"}: ${row.memberEmail}`);
  if(row.equipmentId)parts.push(`апарат ${row.equipmentId}`);
  if(row.reason)parts.push(String(row.reason));
  return parts.join(" · ") || "Рух регістру";
}

export default function BusinessDocumentsPage(){
  const [data,setData]=useState<ListPayload|null>(null);
  const [detail,setDetail]=useState<Detail|null>(null);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");
  const [loadingDetail,setLoadingDetail]=useState(false);

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/staff/business-documents",{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as ListPayload;
      if(!response.ok)throw new Error(payload.error||"Не вдалося завантажити журнал документів");
      setData(payload);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Не вдалося завантажити журнал документів");}
  },[]);

  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);},[load]);

  async function openDocument(id:number){
    setSelectedId(id);setLoadingDetail(true);setError("");
    try{
      const response=await fetch(`/api/staff/business-documents?id=${id}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Detail;
      if(!response.ok)throw new Error(payload.error||"Не вдалося відкрити документ");
      setDetail(payload);
    }catch(e){setDetail(null);setError(e instanceof Error?e.message:"Не вдалося відкрити документ");}
    finally{setLoadingDetail(false);}
  }

  const q=query.trim().toLowerCase();
  const rows=useMemo(()=>{
    const source=data?.documents||[];
    if(!q)return source;
    return source.filter((row)=>`${row.number} ${TYPE_UK[row.journalType]||row.journalType} ${row.bookingCode} ${row.patientName} ${row.subject} ${row.comment}`.toLowerCase().includes(q));
  },[data,q]);

  const totals=useMemo(()=>{
    const source=data?.documents||[];
    return {
      all:source.length,
      posted:source.filter(row=>row.state==="posted").length,
      reversed:source.filter(row=>row.state==="reversed"||row.journalType==="service_correction").length,
      types:new Set(source.map(row=>row.journalType)).size,
    };
  },[data]);

  const movementGroups=detail?Object.entries(detail.movements).filter(([,items])=>items.length>0):[];

  return <StaffWorkspaceShell
    active="finance"
    title="Журнал документів"
    description="Єдиний BAS-журнал: документ, підстава, похідні документи, рухи по регістрах і друковані форми."
  >
    <section className="financeSummary" aria-label="Підсумок журналу документів">
      <article><span>Документів</span><b>{totals.all}</b><small>в одному журналі</small></article>
      <article><span>Проведено</span><b>{totals.posted}</b><small>активних registrar-фактів</small></article>
      <article><span>Сторно / реверс</span><b>{totals.reversed}</b><small>історія не видаляється</small></article>
      <article><span>Типів</span><b>{totals.types}</b><small>єдине business core</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Усі бізнес-документи</b><small>Сортування за датою документа. Журнал не створює нових даних — це read-model канонічних реєстраторів.</small></div>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук: НП, СТ, ОП, пацієнт, послуга…" aria-label="Пошук у журналі документів"/>
        <button type="button" onClick={()=>void load()}>Оновити</button>
      </header>
      {error&&<p className="financeError">{error}</p>}
      {!data&&!error&&<p className="financeLoading">Завантаження журналу…</p>}
      {data&&<div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Документ</th><th>Дата</th><th>Заявка / пацієнт</th><th>Зміст</th><th className="num">Сума / кількість</th><th>Стан</th><th>Підстава</th><th/></tr></thead>
        <tbody>{rows.map(row=><tr key={row.id}>
          <td><b>{row.number||`#${row.id}`}</b><small>{TYPE_UK[row.journalType]||row.journalType}</small></td>
          <td>{dateTime(row.occurredAt)}</td>
          <td>{row.bookingCode?<><b>{row.bookingCode}</b><small>{row.patientName}</small></>:"—"}</td>
          <td>{row.subject||row.comment||"—"}{row.lineCount>0&&<small>{row.lineCount} поз. · {row.totalQuantity} од.</small>}</td>
          <td className="num">{row.amount>0?money(row.amount,row.currency):row.lineCount>0?`${row.totalQuantity} од.`:"—"}</td>
          <td><span className={`financeState state-${row.state}`}>{STATE_UK[row.state]||row.state}</span></td>
          <td>{row.sourceDocumentId?<><b>#{row.sourceDocumentId}</b><small>{REL_UK[row.relationType]||row.relationType}</small></>:"—"}</td>
          <td><button type="button" className={selectedId===row.id?"active":""} onClick={()=>void openDocument(row.id)}>Структура</button></td>
        </tr>)}</tbody>
      </table>{rows.length===0&&<p className="financeEmpty">Документів за цим відбором немає.</p>}</div>}
    </section>

    {(loadingDetail||detail)&&<section className="financeJournal">
      <header className="financeToolbar"><div><b>Структура підпорядкованості</b><small>{loadingDetail?"Завантаження…":detail?`${TYPE_UK[detail.document.journalType]||detail.document.journalType} ${detail.document.number}`:""}</small></div></header>
      {detail&&!loadingDetail&&<>
        <div className="financePrintDetails">
          <p><span>Документ</span><b>{detail.document.number}</b></p>
          <p><span>Тип / стан</span><b>{TYPE_UK[detail.document.journalType]||detail.document.journalType} · {STATE_UK[detail.document.state]||detail.document.state}</b></p>
          <p><span>Створив</span><b>{detail.document.createdBy||"—"}</b></p>
          <p><span>Провів</span><b>{detail.document.postedBy||"—"}</b></p>
          {detail.document.comment&&<p><span>Коментар</span><b>{detail.document.comment}</b></p>}
        </div>

        <div className="financeTableWrap"><table className="financeTable">
          <thead><tr><th>Напрям</th><th>Зв’язок</th><th>Документ</th><th>Тип</th><th>Стан</th><th/></tr></thead>
          <tbody>
            {detail.relations.parent.map(row=><tr key={`p-${row.id}`}><td>← Підстава</td><td>{REL_UK[row.relationType]||row.relationType}</td><td><b>{row.number}</b></td><td>{TYPE_UK[row.journalType]||row.journalType}</td><td>{STATE_UK[row.state]||row.state}</td><td><button onClick={()=>void openDocument(row.id)}>Відкрити</button></td></tr>)}
            {detail.relations.children.map(row=><tr key={`c-${row.id}`}><td>→ Похідний</td><td>{REL_UK[row.relationType]||row.relationType}</td><td><b>{row.number}</b></td><td>{TYPE_UK[row.journalType]||row.journalType}</td><td>{STATE_UK[row.state]||row.state}</td><td><button onClick={()=>void openDocument(row.id)}>Відкрити</button></td></tr>)}
            {detail.relations.parent.length+detail.relations.children.length===0&&<tr><td colSpan={6}>Пов’язаних бізнес-документів немає.</td></tr>}
          </tbody>
        </table></div>

        <div className="financePrintDetails">
          <p><span>Рухів регістрів</span><b>{movementGroups.reduce((sum,[,items])=>sum+items.length,0)}</b></p>
          <p><span>Друкованих snapshot-ів</span><b>{detail.printedForms.length}</b></p>
        </div>
        {movementGroups.map(([register,items])=><div className="financeTableWrap" key={register}><table className="financeTable">
          <thead><tr><th>{REGISTER_UK[register]||register}</th><th>Рух</th><th>Час</th></tr></thead>
          <tbody>{items.map((item,index)=><tr key={`${register}-${String(item.id||index)}`}><td><b>#{String(item.id||index+1)}</b></td><td>{describeMovement(item)}</td><td>{item.occurredAt?dateTime(String(item.occurredAt)):"—"}</td></tr>)}</tbody>
        </table></div>)}
        {detail.printedForms.length>0&&<div className="financeTableWrap"><table className="financeTable">
          <thead><tr><th>Друкована форма</th><th>Версія</th><th>Стан документа</th><th>Сформовано</th><th>SHA-256</th></tr></thead>
          <tbody>{detail.printedForms.map(form=><tr key={form.id}><td>{form.formType}</td><td>v{form.templateVersion}</td><td>{STATE_UK[form.documentState]||form.documentState}</td><td>{dateTime(form.generatedAt)}<small>{form.generatedBy}</small></td><td>{form.sha256.slice(0,12)}…</td></tr>)}</tbody>
        </table></div>}
      </>}
    </section>}
  </StaffWorkspaceShell>;
}
