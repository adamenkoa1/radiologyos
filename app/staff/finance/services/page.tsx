"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type ServiceDelivery={
  id:number;number:string;occurredAt:string;state:string;postedBy:string;
  bookingId:number;bookingCode:string;patientName:string;patientId:string;patientCategory:string;
  serviceCode:string;serviceTitle:string;equipmentId:string;durationMinutes:number;anatomicalRegionsCount:number;
  performedAt:string;radiologistEmail:string;radiographerEmail:string;priceAmount:number;chargeAmount:number;currency:string;
};
type Payload={documents:ServiceDelivery[];error?:string};

const STATE_UK:Record<string,string>={draft:"Чернетка",posted:"Проведено",reversed:"Сторновано",cancelled:"Скасовано"};

function money(value:number,currency="UAH") {
  return new Intl.NumberFormat("uk-UA",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value||0));
}
function dateTime(value:string) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:date.toLocaleString("uk-UA",{dateStyle:"medium",timeStyle:"short"});
}

export default function ServiceDeliveryJournalPage() {
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");

  const load=useCallback(async()=>{
    try {
      const response=await fetch("/api/staff/service-deliveries",{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Payload;
      if(!response.ok) throw new Error(payload.error || "Не вдалося завантажити журнал наданих послуг");
      setData(payload);setError("");
    } catch(e) {
      setError(e instanceof Error?e.message:"Не вдалося завантажити журнал наданих послуг");
    }
  },[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void load();},0);
    return()=>window.clearTimeout(timer);
  },[load]);

  const q=query.trim().toLowerCase();
  const rows=useMemo(()=>{
    const source=data?.documents || [];
    if(!q)return source;
    return source.filter((row)=>`${row.number} ${row.bookingCode} ${row.patientName} ${row.serviceTitle} ${row.serviceCode} ${row.equipmentId} ${row.radiologistEmail} ${row.radiographerEmail}`.toLowerCase().includes(q));
  },[data,q]);

  const totals=useMemo(()=>{
    const source=data?.documents || [];
    return {
      count:source.length,
      charge:source.reduce((sum,row)=>sum+Number(row.chargeAmount||0),0),
      free:source.filter((row)=>Number(row.chargeAmount||0)===0).length,
      minutes:source.reduce((sum,row)=>sum+Number(row.durationMinutes||0),0),
      regions:source.reduce((sum,row)=>sum+Number(row.anatomicalRegionsCount||0),0),
    };
  },[data]);

  function printAct(id:number) {
    window.open(`/staff/finance/services/print?id=${id}`,"_blank","noopener,noreferrer");
  }

  return <StaffWorkspaceShell
    active="finance"
    title="Надані послуги"
    description="BAS-журнал проведених медичних послуг: один документ — один операційний та економічний факт."
  >
    <section className="financeSummary" aria-label="Підсумок журналу наданих послуг">
      <article><span>Документів</span><b>{totals.count}</b><small>проведених надань</small></article>
      <article><span>Нараховано</span><b>{money(totals.charge)}</b><small>цивільні платні послуги</small></article>
      <article><span>Без нарахування</span><b>{totals.free}</b><small>військові / безоплатні</small></article>
      <article><span>Навантаження</span><b>{totals.minutes} хв</b><small>{totals.regions} анатомічних ділянок</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div>
          <b>Журнал документів «Надання послуг»</b>
          <small>Дані формуються з проведених business documents, не з ручних підсумків.</small>
        </div>
        <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Пошук: НП, RD, пацієнт, послуга…" aria-label="Пошук у журналі наданих послуг"/>
        <button type="button" onClick={()=>void load()}>Оновити</button>
      </header>

      {error&&<p className="financeError">{error}</p>}
      {!data&&!error&&<p className="financeLoading">Завантаження журналу…</p>}

      {data&&<div className="financeTableWrap"><table className="financeTable">
        <thead><tr>
          <th>Документ</th><th>Виконано</th><th>Заявка / пацієнт</th><th>Послуга</th><th>Апарат</th>
          <th>Виконавці</th><th className="num">Нарахування</th><th>Стан</th><th/>
        </tr></thead>
        <tbody>{rows.map((row)=><tr key={row.id}>
          <td><b>{row.number}</b><small>Надання послуги</small></td>
          <td>{dateTime(row.performedAt)}<small>{row.durationMinutes} хв · {row.anatomicalRegionsCount} зон.</small></td>
          <td><b>{row.bookingCode}</b><small>{row.patientName}</small></td>
          <td><b>{row.serviceTitle}</b><small>{row.serviceCode}</small></td>
          <td>{row.equipmentId}</td>
          <td>
            <small>{row.radiologistEmail?`Лікар: ${row.radiologistEmail}`:"Лікар: —"}</small>
            <small>{row.radiographerEmail?`Лаборант: ${row.radiographerEmail}`:"Лаборант: —"}</small>
          </td>
          <td className={`num ${row.chargeAmount>0?"positive":""}`}>{row.chargeAmount>0?money(row.chargeAmount,row.currency):"Безоплатно"}</td>
          <td><span className={`financeState state-${row.state}`}>{STATE_UK[row.state]||row.state}</span></td>
          <td><button type="button" onClick={()=>printAct(row.id)}>Акт</button></td>
        </tr>)}</tbody>
      </table>{rows.length===0&&<p className="financeEmpty">Документів за цим відбором немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
