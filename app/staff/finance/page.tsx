"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type FinanceDocument={
  id:number;documentType:"payment"|"refund";number:string;occurredAt:string;state:string;
  bookingId:number;bookingCode:string;patientId:string;patientName:string;service:string;
  amount:number;currency:string;method:string;provider:string;providerReference:string;
  sourceDocumentId:number|null;createdBy:string;postedBy:string;postedAt:string;
};
type CashMovement={
  id:number;documentId:number;documentNumber:string;bookingId:number;bookingCode:string;patientName:string;
  movementType:"payment"|"refund";amountDelta:number;currency:string;method:string;provider:string;
  providerReference:string;actorEmail:string;occurredAt:string;
};
type Settlement={
  bookingId:number;bookingCode:string;patientName:string;patientId:string;service:string;
  currency:string;balance:number;lastMovementAt:string;
};
type FinancePayload={
  documents:FinanceDocument[];cashMovements:CashMovement[];settlements:Settlement[];
  legacyTransactionCount:number;canManage:boolean;error?:string;
};

type Tab="documents"|"cash"|"settlements";

const STATE_UK:Record<string,string>={draft:"Чернетка",posted:"Проведено",reversed:"Сторновано",cancelled:"Скасовано"};
const TYPE_UK={payment:"Оплата",refund:"Повернення"} as const;

function money(value:number,currency="UAH") {
  return new Intl.NumberFormat("uk-UA",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value||0));
}
function dateTime(value:string) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:date.toLocaleString("uk-UA",{dateStyle:"medium",timeStyle:"short"});
}
function methodLabel(value:string) {
  const labels:Record<string,string>={cash:"Готівка",card:"Картка",bank_transfer:"Банківський переказ",privat_link:"Privat24",other:"Інше"};
  return labels[value] || value || "—";
}

export default function FinancePage() {
  const [data,setData]=useState<FinancePayload|null>(null);
  const [error,setError]=useState("");
  const [tab,setTab]=useState<Tab>("documents");
  const [query,setQuery]=useState("");

  const load=useCallback(async()=>{
    try {
      const response=await fetch("/api/staff/finance",{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as FinancePayload;
      if(!response.ok) throw new Error(payload.error || "Не вдалося завантажити фінансовий журнал");
      setData(payload);setError("");
    } catch(e) {
      setError(e instanceof Error?e.message:"Не вдалося завантажити фінансовий журнал");
    }
  },[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void load();},0);
    return()=>window.clearTimeout(timer);
  },[load]);

  const q=query.trim().toLowerCase();
  const documents=useMemo(()=>{
    const rows=data?.documents || [];
    if(!q)return rows;
    return rows.filter((row)=>`${row.number} ${row.bookingCode} ${row.patientName} ${row.service} ${row.providerReference}`.toLowerCase().includes(q));
  },[data,q]);
  const cash=useMemo(()=>{
    const rows=data?.cashMovements || [];
    if(!q)return rows;
    return rows.filter((row)=>`${row.documentNumber} ${row.bookingCode} ${row.patientName} ${row.providerReference}`.toLowerCase().includes(q));
  },[data,q]);
  const settlements=useMemo(()=>{
    const rows=data?.settlements || [];
    if(!q)return rows;
    return rows.filter((row)=>`${row.bookingCode} ${row.patientName} ${row.service}`.toLowerCase().includes(q));
  },[data,q]);

  const totals=useMemo(()=>{
    const rows=data?.cashMovements || [];
    const incoming=rows.filter((row)=>row.amountDelta>0).reduce((sum,row)=>sum+Number(row.amountDelta),0);
    const outgoing=rows.filter((row)=>row.amountDelta<0).reduce((sum,row)=>sum+Math.abs(Number(row.amountDelta)),0);
    return {incoming,outgoing,net:incoming-outgoing};
  },[data]);

  function printDocument(id:number) {
    window.open(`/staff/finance/print?id=${id}`,"_blank","noopener,noreferrer");
  }

  return <StaffWorkspaceShell
    active="finance"
    title="Фінанси"
    description="BAS-подібний журнал наданих послуг, оплат, повернень, рухів грошей і взаєморозрахунків."
  >
    <section className="financeSummary" aria-label="Підсумок фінансового регістру">
      <article><span>Надійшло</span><b>{money(totals.incoming)}</b><small>за BAS-документами</small></article>
      <article><span>Повернено</span><b>{money(totals.outgoing)}</b><small>за BAS-документами</small></article>
      <article><span>Чистий рух</span><b>{money(totals.net)}</b><small>новий регістр cash</small></article>
      <article><span>Документів</span><b>{data?.documents.length || 0}</b><small>оплата / повернення</small></article>
    </section>

    {!!data?.legacyTransactionCount && <aside className="financeLegacyNotice">
      <b>Legacy: {data.legacyTransactionCount}</b>
      <span>Історичні підтверджені транзакції, створені до BAS-реєстратора, не перетворюються на документи заднім числом і не входять у підсумки нового регістру.</span>
    </aside>}

    <section className="financeJournal">
      <header className="financeToolbar">
        <div className="financeTabs" role="tablist" aria-label="Розділи фінансового журналу">
          <button type="button" className={tab==="documents"?"active":""} onClick={()=>setTab("documents")}>Документи</button>
          <button type="button" className={tab==="cash"?"active":""} onClick={()=>setTab("cash")}>Рухи грошей</button>
          <button type="button" className={tab==="settlements"?"active":""} onClick={()=>setTab("settlements")}>Взаєморозрахунки</button>
          <button type="button" onClick={()=>window.location.assign("/staff/finance/services")}>Надані послуги ↗</button>
          <button type="button" onClick={()=>window.location.assign("/staff/documents")}>Усі документи ↗</button>
        </div>
        <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Пошук: документ, RD, пацієнт…" aria-label="Пошук у фінансовому журналі"/>
        <button type="button" onClick={()=>void load()}>Оновити</button>
      </header>

      {error && <p className="financeError">{error}</p>}
      {!data && !error && <p className="financeLoading">Завантаження фінансового журналу…</p>}

      {data && tab==="documents" && <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Документ</th><th>Дата</th><th>Заявка / пацієнт</th><th>Послуга</th><th>Спосіб</th><th className="num">Сума</th><th>Стан</th><th/></tr></thead>
        <tbody>{documents.map((row)=><tr key={row.id}>
          <td><b>{TYPE_UK[row.documentType]}</b><small>{row.number}</small></td>
          <td>{dateTime(row.occurredAt)}</td>
          <td><b>{row.bookingCode}</b><small>{row.patientName}</small></td>
          <td>{row.service}</td>
          <td>{methodLabel(row.method)}{row.providerReference&&<small>{row.providerReference}</small>}</td>
          <td className={`num ${row.documentType==="refund"?"negative":"positive"}`}>{row.documentType==="refund"?"−":"+"}{money(row.amount,row.currency)}</td>
          <td><span className={`financeState state-${row.state}`}>{STATE_UK[row.state]||row.state}</span></td>
          <td><button type="button" onClick={()=>printDocument(row.id)}>Друк</button></td>
        </tr>)}</tbody>
      </table>{documents.length===0&&<p className="financeEmpty">Документів за цим відбором немає.</p>}</div>}

      {data && tab==="cash" && <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Документ</th><th>Дата</th><th>Заявка / пацієнт</th><th>Метод</th><th>Референс</th><th className="num">Рух</th></tr></thead>
        <tbody>{cash.map((row)=><tr key={row.id}>
          <td><b>{row.documentNumber}</b><small>{row.movementType==="payment"?"Оплата":"Повернення"}</small></td>
          <td>{dateTime(row.occurredAt)}</td>
          <td><b>{row.bookingCode}</b><small>{row.patientName}</small></td>
          <td>{methodLabel(row.method)}</td><td>{row.providerReference||"—"}</td>
          <td className={`num ${row.amountDelta<0?"negative":"positive"}`}>{row.amountDelta<0?"−":"+"}{money(Math.abs(row.amountDelta),row.currency)}</td>
        </tr>)}</tbody>
      </table>{cash.length===0&&<p className="financeEmpty">Рухів за цим відбором немає.</p>}</div>}

      {data && tab==="settlements" && <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Заявка</th><th>Пацієнт</th><th>Послуга</th><th>Останній рух</th><th className="num">Сальдо</th></tr></thead>
        <tbody>{settlements.map((row)=><tr key={row.bookingId}>
          <td><b>{row.bookingCode}</b></td><td>{row.patientName}</td><td>{row.service}</td><td>{dateTime(row.lastMovementAt)}</td>
          <td className={`num ${row.balance>0?"negative":row.balance<0?"positive":""}`}>{money(row.balance,row.currency)}</td>
        </tr>)}</tbody>
      </table>{settlements.length===0&&<p className="financeEmpty">Взаєморозрахунків за цим відбором немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
