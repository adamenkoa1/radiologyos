"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Totals={
  acts:number;civilianActs:number;militaryActs:number;revenue:number;
  studies:number;minutes:number;regions:number;staffAssignments:number;unpostedPerformedCount:number;
};
type ServiceAct={
  id:number;number:string;occurredAt:string;state:string;bookingId:number;bookingCode:string;
  patientName:string;patientId:string;serviceCode:string;serviceName:string;patientCategory:string;
  chargeAmount:number;currency:string;equipmentId:string;durationMinutes:number;performedAt:string;
  anatomicalRegionsCount:number;radiologistEmail:string;radiographerEmail:string;
};
type RevenueMovement={
  id:number;documentId:number;documentNumber:string;bookingId:number;bookingCode:string;patientName:string;
  movementType:string;amountDelta:number;currency:string;serviceCode:string;actorEmail:string;occurredAt:string;
};
type EquipmentWorkload={
  id:number;documentId:number;documentNumber:string;bookingId:number;bookingCode:string;equipmentId:string;
  studyCount:number;durationMinutes:number;anatomicalRegionsCount:number;performedAt:string;
};
type StaffOutput={
  id:number;documentId:number;documentNumber:string;bookingId:number;bookingCode:string;staffEmail:string;
  staffRole:"radiologist"|"radiographer";studyCount:number;anatomicalRegionsCount:number;performedAt:string;
};
type Payload={
  totals:Totals;documents:ServiceAct[];revenueMovements:RevenueMovement[];
  equipmentWorkload:EquipmentWorkload[];staffOutput:StaffOutput[];error?:string;
};
type Tab="acts"|"revenue"|"equipment"|"staff";

const CATEGORY_UK:Record<string,string>={civilian:"Цивільний",military:"Військовий"};
const ROLE_UK:Record<string,string>={radiologist:"Лікар-рентгенолог",radiographer:"Рентгенолаборант"};
function money(value:number,currency="UAH"){
  return new Intl.NumberFormat("uk-UA",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value||0));
}
function dateTime(value:string){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:date.toLocaleString("uk-UA",{dateStyle:"medium",timeStyle:"short"});
}

export default function ServiceDeliveryPage(){
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState("");
  const [tab,setTab]=useState<Tab>("acts");
  const [query,setQuery]=useState("");

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/staff/service-delivery",{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Payload;
      if(!response.ok)throw new Error(payload.error||"Не вдалося завантажити журнал наданих послуг");
      setData(payload);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Не вдалося завантажити журнал наданих послуг");}
  },[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void load();},0);
    return()=>window.clearTimeout(timer);
  },[load]);

  const q=query.trim().toLowerCase();
  const acts=useMemo(()=>{
    const rows=data?.documents||[];
    if(!q)return rows;
    return rows.filter(row=>`${row.number} ${row.bookingCode} ${row.patientName} ${row.serviceName} ${row.equipmentId}`.toLowerCase().includes(q));
  },[data,q]);
  const revenue=useMemo(()=>{
    const rows=data?.revenueMovements||[];
    if(!q)return rows;
    return rows.filter(row=>`${row.documentNumber} ${row.bookingCode} ${row.patientName} ${row.serviceCode}`.toLowerCase().includes(q));
  },[data,q]);
  const equipment=useMemo(()=>{
    const rows=data?.equipmentWorkload||[];
    if(!q)return rows;
    return rows.filter(row=>`${row.documentNumber} ${row.bookingCode} ${row.equipmentId}`.toLowerCase().includes(q));
  },[data,q]);
  const staff=useMemo(()=>{
    const rows=data?.staffOutput||[];
    if(!q)return rows;
    return rows.filter(row=>`${row.documentNumber} ${row.bookingCode} ${row.staffEmail} ${row.staffRole}`.toLowerCase().includes(q));
  },[data,q]);

  function printAct(id:number){window.open(`/staff/service-delivery/print?id=${id}`,"_blank","noopener,noreferrer");}

  return <StaffWorkspaceShell
    active="finance"
    title="Надані послуги"
    description="BAS-журнал актів виконаних досліджень, доходу, навантаження обладнання та виробітку персоналу."
  >
    <section className="financeSummary" aria-label="Підсумок наданих послуг">
      <article><span>Актів</span><b>{data?.totals.acts||0}</b><small>{data?`${data.totals.civilianActs} цив. · ${data.totals.militaryActs} військ.`:"—"}</small></article>
      <article><span>Визнаний дохід</span><b>{money(data?.totals.revenue||0)}</b><small>тільки проведені цивільні послуги</small></article>
      <article><span>Дослідження / зони</span><b>{data?`${data.totals.studies} / ${data.totals.regions}`:"0 / 0"}</b><small>{data?.totals.minutes||0} хв навантаження</small></article>
      <article><span>Виробіток</span><b>{data?.totals.staffAssignments||0}</b><small>призначень виконавців</small></article>
    </section>

    {!!data?.totals.unpostedPerformedCount&&<aside className="financeLegacyNotice">
      <b>Виконано без Акта: {data.totals.unpostedPerformedCount}</b>
      <span>Це історичні або незавершені business-core факти. Система їх показує, але не створює Акти заднім числом автоматично.</span>
    </aside>}

    <section className="financeJournal">
      <header className="financeToolbar">
        <div className="financeTabs" role="tablist" aria-label="Розділи журналу наданих послуг">
          <button type="button" className={tab==="acts"?"active":""} onClick={()=>setTab("acts")}>Акти</button>
          <button type="button" className={tab==="revenue"?"active":""} onClick={()=>setTab("revenue")}>Дохід</button>
          <button type="button" className={tab==="equipment"?"active":""} onClick={()=>setTab("equipment")}>Обладнання</button>
          <button type="button" className={tab==="staff"?"active":""} onClick={()=>setTab("staff")}>Виробіток</button>
        </div>
        <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Пошук: акт, RD, пацієнт, апарат…" aria-label="Пошук у журналі наданих послуг"/>
        <button type="button" onClick={()=>void load()}>Оновити</button>
      </header>

      {error&&<p className="financeError">{error}</p>}
      {!data&&!error&&<p className="financeLoading">Завантаження журналу наданих послуг…</p>}

      {data&&tab==="acts"&&<div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Акт</th><th>Виконано</th><th>Заявка / пацієнт</th><th>Послуга</th><th>Категорія</th><th>Апарат / зони</th><th className="num">Сума</th><th/></tr></thead>
        <tbody>{acts.map(row=><tr key={row.id}>
          <td><b>{row.number}</b><small>Проведено</small></td>
          <td>{dateTime(row.performedAt)}</td>
          <td><b>{row.bookingCode}</b><small>{row.patientName}</small></td>
          <td>{row.serviceName}<small>{row.serviceCode}</small></td>
          <td>{CATEGORY_UK[row.patientCategory]||row.patientCategory}</td>
          <td>{row.equipmentId}<small>{row.anatomicalRegionsCount} зон · {row.durationMinutes} хв</small></td>
          <td className="num">{row.chargeAmount?money(row.chargeAmount,row.currency):"Безоплатно"}</td>
          <td><button type="button" onClick={()=>printAct(row.id)}>Акт</button></td>
        </tr>)}</tbody>
      </table>{acts.length===0&&<p className="financeEmpty">Актів за цим відбором немає.</p>}</div>}

      {data&&tab==="revenue"&&<div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Документ</th><th>Дата</th><th>Заявка / пацієнт</th><th>Послуга</th><th>Відповідальний</th><th className="num">Дохід</th></tr></thead>
        <tbody>{revenue.map(row=><tr key={row.id}>
          <td><b>{row.documentNumber}</b></td><td>{dateTime(row.occurredAt)}</td>
          <td><b>{row.bookingCode}</b><small>{row.patientName}</small></td><td>{row.serviceCode}</td><td>{row.actorEmail}</td>
          <td className="num positive">+{money(row.amountDelta,row.currency)}</td>
        </tr>)}</tbody>
      </table>{revenue.length===0&&<p className="financeEmpty">Рухів доходу за цим відбором немає.</p>}</div>}

      {data&&tab==="equipment"&&<div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Документ</th><th>Виконано</th><th>Заявка</th><th>Обладнання</th><th className="num">Досліджень</th><th className="num">Зон</th><th className="num">Хвилин</th></tr></thead>
        <tbody>{equipment.map(row=><tr key={row.id}>
          <td><b>{row.documentNumber}</b></td><td>{dateTime(row.performedAt)}</td><td>{row.bookingCode}</td><td>{row.equipmentId}</td>
          <td className="num">{row.studyCount}</td><td className="num">{row.anatomicalRegionsCount}</td><td className="num">{row.durationMinutes}</td>
        </tr>)}</tbody>
      </table>{equipment.length===0&&<p className="financeEmpty">Навантаження за цим відбором немає.</p>}</div>}

      {data&&tab==="staff"&&<div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Документ</th><th>Виконано</th><th>Заявка</th><th>Працівник</th><th>Роль</th><th className="num">Досліджень</th><th className="num">Зон</th></tr></thead>
        <tbody>{staff.map(row=><tr key={row.id}>
          <td><b>{row.documentNumber}</b></td><td>{dateTime(row.performedAt)}</td><td>{row.bookingCode}</td><td>{row.staffEmail}</td>
          <td>{ROLE_UK[row.staffRole]||row.staffRole}</td><td className="num">{row.studyCount}</td><td className="num">{row.anatomicalRegionsCount}</td>
        </tr>)}</tbody>
      </table>{staff.length===0&&<p className="financeEmpty">Виробітку за цим відбором немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
