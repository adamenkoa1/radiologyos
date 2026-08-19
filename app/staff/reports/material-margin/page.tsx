"use client";

import { useEffect,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type Row={
  serviceCode:string;serviceTitle:string;performedNet:number;revenueBookings:number;costBookings:number;
  netRevenue:number;materialCost:number;contribution:number;marginPct:number|null;
};
type Report={
  period:{from:string;to:string};generatedAt:string;scope:"material_contribution";
  summary:{netRevenue:number;linkedMaterialCost:number;unlinkedMaterialCost:number;contribution:number;marginPct:number|null;serviceCount:number};
  rows:Row[];error?:string;
};

function todayInKyiv(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
const initialTo=todayInKyiv();
const initialFrom=`${initialTo.slice(0,7)}-01`;
function money(value:number){return new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(Number(value||0));}
function pct(value:number|null){return value===null?"—":`${new Intl.NumberFormat("uk-UA",{maximumFractionDigits:1}).format(value)}%`;}
function qty(value:number){return new Intl.NumberFormat("uk-UA",{maximumFractionDigits:2}).format(Number(value||0));}

export default function ServiceMaterialMarginPage(){
  const [from,setFrom]=useState(initialFrom);
  const [to,setTo]=useState(initialTo);
  const [data,setData]=useState<Report|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const exportUrl=`/api/staff/reports/material-margin/export?${new URLSearchParams({from,to}).toString()}`;

  async function load(){
    setLoading(true);setError("");
    try{
      const query=new URLSearchParams({from,to}).toString();
      const response=await fetch(`/api/staff/reports/material-margin?${query}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Report;
      if(!response.ok)throw new Error(payload.error||"Не вдалося сформувати звіт маржинальності");
      setData(payload);
    }catch(e){setData(null);setError(e instanceof Error?e.message:"Не вдалося сформувати звіт маржинальності");}
    finally{setLoading(false);}
  }

  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);/* eslint-disable-next-line react-hooks/exhaustive-deps */},[]);

  return <StaffWorkspaceShell
    active="reports"
    title="Маржинальність послуг — матеріали"
    description="Read-only BAS-подібний зріз: проведений дохід мінус фактична собівартість списаних матеріалів."
  >
    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Період оборотів</b><small>Суми беруться тільки з immutable revenue та expense movements за датою проведення.</small></div>
        <label><span>Від</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label><span>До</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <button type="button" disabled={loading} onClick={()=>void load()}>{loading?"Формування…":"Сформувати"}</button>
        <a className="excelButton" href={exportUrl}>CSV</a>
        <a className="excelButton" href="/staff/reports/material-consumption-control">План / факт</a>
        <a className="excelButton" href="/staff/reports/registers">Обороти регістрів</a>
        <a className="excelButton" href="/staff/reports">Звіти</a>
      </header>
      {error&&<p className="financeError">{error}</p>}
      <p className="financeHint"><b>Не є повним прибутком.</b> У розрахунок входить лише матеріальна собівартість. Зарплата, амортизація обладнання, електроенергія та інші накладні витрати не розподіляються.</p>
      {data&&data.summary.unlinkedMaterialCost>0&&<p className="financeError">Неприв’язані до заявки списання: {money(data.summary.unlinkedMaterialCost)}. Вони не розподіляються по послугах автоматично і не зменшують їхню маржу.</p>}
    </section>

    {data&&<>
      <section className="financeSummary" aria-label="Матеріальна маржинальність">
        <article><span>Чистий дохід</span><b>{money(data.summary.netRevenue)}</b><small>service delivery з урахуванням storno</small></article>
        <article><span>Матеріали</span><b>{money(data.summary.linkedMaterialCost)}</b><small>лише списання, прив’язані до заявки</small></article>
        <article><span>Матеріальний внесок</span><b>{money(data.summary.contribution)}</b><small>дохід − матеріальна собівартість</small></article>
        <article><span>Матеріальна маржа</span><b>{pct(data.summary.marginPct)}</b><small>не розраховується при нульовому/від’ємному доході</small></article>
        <article><span>Неприв’язані списання</span><b>{money(data.summary.unlinkedMaterialCost)}</b><small>окремо, без штучного розподілу</small></article>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>По послугах</b><small>{data.summary.serviceCount} кодів із проведеними виконаннями, доходом або матеріальною собівартістю за період.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr>
          <th>Послуга</th><th className="num">Виконано, нетто</th><th className="num">Дохід</th><th className="num">Матеріали</th><th className="num">Внесок</th><th className="num">Маржа</th>
        </tr></thead><tbody>
          {data.rows.map(row=><tr key={row.serviceCode}>
            <td><b>{row.serviceTitle||row.serviceCode}</b><small>{row.serviceCode} · дохід: {row.revenueBookings} заявок · матеріали: {row.costBookings} заявок</small></td>
            <td className="num">{qty(row.performedNet)}</td>
            <td className="num">{money(row.netRevenue)}</td>
            <td className="num">{money(row.materialCost)}</td>
            <td className="num"><b>{money(row.contribution)}</b></td>
            <td className="num"><b>{pct(row.marginPct)}</b></td>
          </tr>)}
          {data.rows.length===0&&<tr><td colSpan={6}>За обраний період немає проведених доходів, виконань або прив’язаних матеріальних витрат.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </StaffWorkspaceShell>;
}
