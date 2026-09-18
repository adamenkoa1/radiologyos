"use client";

import { useEffect,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type Row={
  serviceCode:string;serviceTitle:string;itemId:number;itemSku:string;itemName:string;itemUnit:string;
  warehouseId:number;warehouseCode:string;warehouseName:string;reservationCount:number;bookingCount:number;
  plannedQuantity:number;postedQuantity:number;draftQuantity:number;unpostedQuantity:number;unallocatedQuantity:number;
  coveragePct:number;fullyPostedReservations:number;draftReservations:number;needsAllocationReservations:number;
};
type Report={
  period:{from:string;to:string};generatedAt:string;actualAsOf:string;scope:"material_consumption_control";
  summary:{completedBookings:number;reservationFacts:number;fullyPosted:number;withDraft:number;needsAllocation:number;fullyPostedPct:number;rowCount:number};
  rows:Row[];error?:string;
};

function todayInKyiv(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
const initialTo=todayInKyiv();
const initialFrom=`${initialTo.slice(0,7)}-01`;
function qty(value:number){return new Intl.NumberFormat("uk-UA",{maximumFractionDigits:3}).format(Number(value||0));}
function pct(value:number){return `${new Intl.NumberFormat("uk-UA",{maximumFractionDigits:1}).format(Number(value||0))}%`;}
function moment(value:string){
  const date=new Date(value);if(Number.isNaN(date.getTime()))return value;
  return new Intl.DateTimeFormat("uk-UA",{timeZone:"Europe/Kyiv",dateStyle:"short",timeStyle:"short"}).format(date);
}

export default function MaterialConsumptionControlPage(){
  const [from,setFrom]=useState(initialFrom);
  const [to,setTo]=useState(initialTo);
  const [data,setData]=useState<Report|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const exportUrl=`/api/staff/reports/material-consumption-control/export?${new URLSearchParams({from,to}).toString()}`;

  async function load(){
    setLoading(true);setError("");
    try{
      const query=new URLSearchParams({from,to}).toString();
      const response=await fetch(`/api/staff/reports/material-consumption-control?${query}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Report;
      if(!response.ok)throw new Error(payload.error||"Не вдалося сформувати контроль списання матеріалів");
      setData(payload);
    }catch(e){setData(null);setError(e instanceof Error?e.message:"Не вдалося сформувати контроль списання матеріалів");}
    finally{setLoading(false);}
  }

  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);/* eslint-disable-next-line react-hooks/exhaustive-deps */},[]);

  return <StaffWorkspaceShell
    active="reports"
    title="Матеріали: план / факт списання"
    description="Операційний контроль історичної норми матеріалів проти фактичного проведеного списання."
  >
    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Період виконання послуг</b><small>Відбір — за performed_at. План береться з immutable reserve поточної Appointment-версії.</small></div>
        <label><span>Від</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label><span>До</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <button type="button" disabled={loading} onClick={()=>void load()}>{loading?"Формування…":"Сформувати"}</button>
        <a className="excelButton" href={exportUrl}>CSV</a>
        <a className="excelButton" href="/staff/reports/material-margin">Маржинальність</a>
        <a className="excelButton" href="/staff/inventory/material-consumption">Робочий список</a>
        <a className="excelButton" href="/staff/reports">Звіти</a>
      </header>
      {error&&<p className="financeError">{error}</p>}
      <p className="financeHint"><b>Факт = тільки фізичний posted writeoff.</b> Draft показується окремо. Списання може бути проведене пізніше за дату виконання послуги, тому стан факту фіксується на момент формування звіту.</p>
      {data&&<p className="financeHint">Стан списань на: <b>{moment(data.actualAsOf)}</b>.</p>}
      {data&&data.summary.needsAllocation>0&&<p className="financeError">Є {data.summary.needsAllocation} reservation-фактів, де частина плану ще не розподілена навіть у draft.</p>}
    </section>

    {data&&<>
      <section className="financeSummary" aria-label="Контроль списання матеріалів">
        <article><span>Виконані заявки</span><b>{data.summary.completedBookings}</b><small>із матеріальним reserve у періоді</small></article>
        <article><span>Планові позиції</span><b>{data.summary.reservationFacts}</b><small>immutable reservation facts</small></article>
        <article><span>Повністю списано</span><b>{data.summary.fullyPosted}</b><small>{pct(data.summary.fullyPostedPct)} планових позицій</small></article>
        <article><span>Є draft</span><b>{data.summary.withDraft}</b><small>ще не фізичний факт складу</small></article>
        <article><span>Потрібне розподілення</span><b>{data.summary.needsAllocation}</b><small>план − posted − draft &gt; 0</small></article>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>По послугах і матеріалах</b><small>{data.summary.rowCount} однорідних груп; кількості не сумуються між різними одиницями виміру.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr>
          <th>Послуга / матеріал</th><th>Склад</th><th className="num">План</th><th className="num">Факт</th><th className="num">Draft</th><th className="num">Не проведено</th><th className="num">Не розподілено</th><th className="num">Покриття</th>
        </tr></thead><tbody>
          {data.rows.map(row=><tr key={`${row.serviceCode}:${row.itemId}:${row.warehouseId}`}>
            <td><b>{row.serviceTitle||row.serviceCode}</b><small>{row.serviceCode}</small><br/><b>{row.itemName||row.itemSku}</b><small>{row.itemSku||`ID ${row.itemId}`} · {row.reservationCount} план. позицій / {row.bookingCount} заявок</small></td>
            <td><b>{row.warehouseName}</b><small>{row.warehouseCode}</small></td>
            <td className="num">{qty(row.plannedQuantity)} {row.itemUnit}</td>
            <td className="num"><b>{qty(row.postedQuantity)} {row.itemUnit}</b></td>
            <td className="num">{qty(row.draftQuantity)} {row.itemUnit}</td>
            <td className="num">{qty(row.unpostedQuantity)} {row.itemUnit}</td>
            <td className="num">{qty(row.unallocatedQuantity)} {row.itemUnit}</td>
            <td className="num"><b>{pct(row.coveragePct)}</b></td>
          </tr>)}
          {data.rows.length===0&&<tr><td colSpan={8}>За обраний період немає виконаних заявок із плановими матеріалами.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </StaffWorkspaceShell>;
}
