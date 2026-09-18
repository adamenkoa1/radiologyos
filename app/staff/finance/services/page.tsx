"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type ServiceDelivery={
  id:number;number:string;occurredAt:string;state:string;postedBy:string;
  bookingId:number;bookingCode:string;patientName:string;patientId:string;patientCategory:string;
  serviceCode:string;serviceTitle:string;equipmentId:string;durationMinutes:number;anatomicalRegionsCount:number;
  performedAt:string;radiologistEmail:string;radiographerEmail:string;priceAmount:number;chargeAmount:number;currency:string;
};
type ServiceCorrection={
  id:number;number:string;occurredAt:string;state:string;postedBy:string;
  sourceDocumentId:number;sourceDocumentNumber:string;bookingId:number;bookingCode:string;patientName:string;
  reason:string;patientId:string;patientCategory:string;serviceCode:string;serviceTitle:string;equipmentId:string;
  durationMinutes:number;anatomicalRegionsCount:number;performedAt:string;radiologistEmail:string;
  radiographerEmail:string;chargeAmount:number;currency:string;
};
type Payload={documents:ServiceDelivery[];error?:string};
type CorrectionPayload={documents:ServiceCorrection[];error?:string};

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
  const [corrections,setCorrections]=useState<ServiceCorrection[]>([]);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [busyId,setBusyId]=useState<number|null>(null);

  const load=useCallback(async()=>{
    try {
      const [servicesResponse,correctionsResponse]=await Promise.all([
        fetch("/api/staff/service-deliveries",{cache:"no-store"}),
        fetch("/api/staff/service-deliveries/corrections",{cache:"no-store"}),
      ]);
      const [servicesPayload,correctionsPayload]=await Promise.all([
        servicesResponse.json().catch(()=>({})) as Promise<Payload>,
        correctionsResponse.json().catch(()=>({})) as Promise<CorrectionPayload>,
      ]);
      if(!servicesResponse.ok) throw new Error(servicesPayload.error || "Не вдалося завантажити журнал наданих послуг");
      if(!correctionsResponse.ok) throw new Error(correctionsPayload.error || "Не вдалося завантажити журнал сторно");
      setData(servicesPayload);
      setCorrections(correctionsPayload.documents || []);
      setError("");
    } catch(e) {
      setError(e instanceof Error?e.message:"Не вдалося завантажити журнал наданих послуг");
    }
  },[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void load();},0);
    return()=>window.clearTimeout(timer);
  },[load]);

  const correctionBySource=useMemo(()=>{
    const map=new Map<number,ServiceCorrection>();
    for(const correction of corrections) map.set(correction.sourceDocumentId,correction);
    return map;
  },[corrections]);

  const q=query.trim().toLowerCase();
  const rows=useMemo(()=>{
    const source=data?.documents || [];
    if(!q)return source;
    return source.filter((row)=>{
      const correction=correctionBySource.get(row.id);
      return `${row.number} ${row.bookingCode} ${row.patientName} ${row.serviceTitle} ${row.serviceCode} ${row.equipmentId} ${row.radiologistEmail} ${row.radiographerEmail} ${correction?.number||""} ${correction?.reason||""}`.toLowerCase().includes(q);
    });
  },[data,q,correctionBySource]);

  const totals=useMemo(()=>{
    const active=(data?.documents || []).filter((row)=>row.state==="posted");
    return {
      count:active.length,
      charge:active.reduce((sum,row)=>sum+Number(row.chargeAmount||0),0),
      free:active.filter((row)=>Number(row.chargeAmount||0)===0).length,
      minutes:active.reduce((sum,row)=>sum+Number(row.durationMinutes||0),0),
      regions:active.reduce((sum,row)=>sum+Number(row.anatomicalRegionsCount||0),0),
      corrections:corrections.length,
    };
  },[data,corrections]);

  function printAct(id:number) {
    window.open(`/staff/finance/services/print?id=${id}`,"_blank","noopener,noreferrer");
  }

  async function reverseService(row:ServiceDelivery) {
    if(row.state!=="posted" || correctionBySource.has(row.id) || busyId!==null) return;
    const reason=window.prompt(`Причина сторно документа ${row.number}:`,"")?.trim();
    if(reason===undefined) return;
    if(reason.length<5) {
      setError("Причина сторно має містити щонайменше 5 символів.");
      return;
    }
    setBusyId(row.id);
    setError("");
    try {
      const response=await fetch("/api/staff/service-deliveries/corrections",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({sourceDocumentId:row.id,reason}),
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) throw new Error(payload.error || "Не вдалося провести сторно");
      await load();
    } catch(e) {
      setError(e instanceof Error?e.message:"Не вдалося провести сторно");
    } finally {
      setBusyId(null);
    }
  }

  return <StaffWorkspaceShell
    active="finance"
    title="Надані послуги"
    description="BAS-журнал проведених медичних послуг і окремих документів сторно. Проведені факти не редагуються заднім числом."
  >
    <section className="financeSummary" aria-label="Підсумок журналу наданих послуг">
      <article><span>Чинних надань</span><b>{totals.count}</b><small>{totals.free} безоплатних</small></article>
      <article><span>Чинне нарахування</span><b>{money(totals.charge)}</b><small>без сторнованих документів</small></article>
      <article><span>Сторно</span><b>{totals.corrections}</b><small>окремих документів-коректорів</small></article>
      <article><span>Чинне навантаження</span><b>{totals.minutes} хв</b><small>{totals.regions} анатомічних ділянок</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div>
          <b>Журнал документів «Надання послуг»</b>
          <small>Сторно створює окремий документ і негативні рухи; оригінал залишається в історії.</small>
        </div>
        <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Пошук: НП, СТ, RD, пацієнт, причина…" aria-label="Пошук у журналі наданих послуг"/>
        <button type="button" onClick={()=>void load()} disabled={busyId!==null}>Оновити</button>
      </header>

      {error&&<p className="financeError">{error}</p>}
      {!data&&!error&&<p className="financeLoading">Завантаження журналу…</p>}

      {data&&<div className="financeTableWrap"><table className="financeTable">
        <thead><tr>
          <th>Документ</th><th>Виконано</th><th>Заявка / пацієнт</th><th>Послуга</th><th>Апарат</th>
          <th>Виконавці</th><th className="num">Нарахування</th><th>Стан / корекція</th><th/>
        </tr></thead>
        <tbody>{rows.map((row)=>{
          const correction=correctionBySource.get(row.id);
          return <tr key={row.id}>
            <td><b>{row.number}</b><small>Надання послуги</small></td>
            <td>{dateTime(row.performedAt)}<small>{row.durationMinutes} хв · {row.anatomicalRegionsCount} зон.</small></td>
            <td><b>{row.bookingCode}</b><small>{row.patientName}</small></td>
            <td><b>{row.serviceTitle}</b><small>{row.serviceCode}</small></td>
            <td>{row.equipmentId}</td>
            <td>
              <small>{row.radiologistEmail?`Лікар: ${row.radiologistEmail}`:"Лікар: —"}</small>
              <small>{row.radiographerEmail?`Лаборант: ${row.radiographerEmail}`:"Лаборант: —"}</small>
            </td>
            <td className={`num ${row.state==="posted"&&row.chargeAmount>0?"positive":""}`}>
              {row.state==="reversed"?<><s>{row.chargeAmount>0?money(row.chargeAmount,row.currency):"Безоплатно"}</s><small>сторновано</small></>:row.chargeAmount>0?money(row.chargeAmount,row.currency):"Безоплатно"}
            </td>
            <td>
              <span className={`financeState state-${row.state}`}>{STATE_UK[row.state]||row.state}</span>
              {correction&&<><small><b>{correction.number}</b> · {dateTime(correction.occurredAt)}</small><small>{correction.reason}</small></>}
            </td>
            <td>
              <button type="button" onClick={()=>printAct(row.id)}>Акт</button>
              {row.state==="posted"&&!correction&&<button type="button" disabled={busyId!==null} onClick={()=>void reverseService(row)}>{busyId===row.id?"Сторно…":"Сторно"}</button>}
            </td>
          </tr>;
        })}</tbody>
      </table>{rows.length===0&&<p className="financeEmpty">Документів за цим відбором немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
