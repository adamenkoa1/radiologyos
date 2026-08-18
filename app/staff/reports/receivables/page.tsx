"use client";

import { useEffect,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type DebtRow={
  bookingId:number;bookingCode:string;patientId:string;patientName:string;serviceTitle:string;
  currency:string;balance:number;outstandingSince:string;ageDays:number;bucket:"0_30"|"31_60"|"61_90"|"90_plus";
};
type CreditRow={bookingId:number;bookingCode:string;patientId:string;patientName:string;serviceTitle:string;currency:string;balance:number};
type Report={
  asOf:string;generatedAt:string;truncated:boolean;
  summary:{receivables:number;patientCredits:number;debtorBookings:number;creditBookings:number;buckets:Record<DebtRow["bucket"],number>};
  debtors:DebtRow[];credits:CreditRow[];error?:string;
};

function todayInKyiv(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function money(value:number){return new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(Number(value||0));}
const BUCKET_UK:Record<DebtRow["bucket"],string>={"0_30":"0–30 днів","31_60":"31–60 днів","61_90":"61–90 днів","90_plus":"понад 90 днів"};

export default function ReceivablesPage(){
  const [asOf,setAsOf]=useState(todayInKyiv());
  const [data,setData]=useState<Report|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  async function load(){
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/staff/reports/receivables?asOf=${encodeURIComponent(asOf)}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Report;
      if(!response.ok)throw new Error(payload.error||"Не вдалося сформувати дебіторську відомість");
      setData(payload);
    }catch(e){setData(null);setError(e instanceof Error?e.message:"Не вдалося сформувати дебіторську відомість");}
    finally{setLoading(false);}
  }

  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);/* eslint-disable-next-line react-hooks/exhaustive-deps */},[]);

  return <StaffWorkspaceShell
    active="reports"
    title="Дебіторська заборгованість"
    description="BAS-подібна відомість станом на дату з immutable взаєморозрахунків із пацієнтами."
  >
    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Станом на дату</b><small>Борг не визначається зі статусу заявки — тільки із проведених charge/payment/refund/storno рухів.</small></div>
        <label><span>Дата</span><input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)}/></label>
        <button type="button" disabled={loading} onClick={()=>void load()}>{loading?"Формування…":"Сформувати"}</button>
        <a className="excelButton" href="/staff/reports/registers">Обороти регістрів</a>
      </header>
      {error&&<p className="financeError">{error}</p>}
      {data?.truncated&&<p className="financeError">Показано перші 2000 ненульових сальдо. Для повної відомості звузьте контур даних або використайте експорт після його додавання.</p>}
    </section>

    {data&&<>
      <section className="financeSummary" aria-label="Дебіторська заборгованість">
        <article><span>Пацієнти винні</span><b>{money(data.summary.receivables)}</b><small>{data.summary.debtorBookings} заявок із боргом</small></article>
        <article><span>Кредит пацієнтів</span><b>{money(data.summary.patientCredits)}</b><small>{data.summary.creditBookings} заявок із переплатою</small></article>
        <article><span>0–30 днів</span><b>{money(data.summary.buckets["0_30"])}</b><small>поточна дебіторка</small></article>
        <article><span>31–60 днів</span><b>{money(data.summary.buckets["31_60"])}</b><small>потребує контролю</small></article>
        <article><span>61–90 днів</span><b>{money(data.summary.buckets["61_90"])}</b><small>прострочена</small></article>
        <article><span>Понад 90 днів</span><b>{money(data.summary.buckets["90_plus"])}</b><small>довгострокова</small></article>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Заборгованість по заявках</b><small>Позитивне сальдо показується окремо по кожній заявці; борги різних заявок не взаємозаліковуються.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Пацієнт / заявка</th><th>Послуга</th><th>Борг від</th><th>Вік</th><th className="num">Сума</th></tr></thead><tbody>
          {data.debtors.map(row=><tr key={`${row.bookingId}-${row.currency}`}><td><b>{row.patientName||"—"}</b><small>{row.bookingCode}{row.patientId?` · ${row.patientId}`:""}</small></td><td>{row.serviceTitle||"—"}</td><td>{row.outstandingSince||"—"}</td><td>{BUCKET_UK[row.bucket]}<small>{row.ageDays} дн.</small></td><td className="num"><b>{money(row.balance)}</b></td></tr>)}
          {data.debtors.length===0&&<tr><td colSpan={5}>Непогашеної дебіторської заборгованості немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Кредит / переплата пацієнтів</b><small>Від’ємне сальдо не віднімається від чужої або іншої заявкової дебіторки.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Пацієнт / заявка</th><th>Послуга</th><th className="num">Кредит</th></tr></thead><tbody>
          {data.credits.map(row=><tr key={`${row.bookingId}-${row.currency}`}><td><b>{row.patientName||"—"}</b><small>{row.bookingCode}{row.patientId?` · ${row.patientId}`:""}</small></td><td>{row.serviceTitle||"—"}</td><td className="num"><b>{money(Math.abs(row.balance))}</b></td></tr>)}
          {data.credits.length===0&&<tr><td colSpan={3}>Переплат / кредитів пацієнтів немає.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </StaffWorkspaceShell>;
}
