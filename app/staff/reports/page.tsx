"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type StaffInfo = { email:string; displayName:string; role:string };
type Summary = {
  total:number; active:number; completed:number; cancelled:number;
  military:number; civilian:number; protocolsReady:number; awaitingProtocol:number;
  pendingPayments:number; paidRevenue:number; expectedRevenue:number; nszuPending:number;
};
type EquipmentRow = { id:string; name:string; count:number };
type ServiceRow = { code:string; title:string; count:number; revenue:number };
type DayRow = {
  date:string; total:number; completed:number; cancelled:number;
  military:number; civilian:number; revenue:number;
};
type SourceRow = { source:string; count:number };
type ReportData = {
  from:string; to:string; summary:Summary; byEquipment:EquipmentRow[];
  byService:ServiceRow[]; byDay:DayRow[]; bySource:SourceRow[]; staff:StaffInfo;
};

const roleLabels: Record<string,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};

function todayInKyiv() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Kyiv", year:"numeric", month:"2-digit", day:"2-digit",
  }).format(new Date());
}

const INITIAL_REPORT_PERIOD = (() => {
  const today = todayInKyiv();
  return { from:`${today.slice(0,7)}-01`, to:today };
})();

function formatMoney(value:number) {
  return new Intl.NumberFormat("uk-UA").format(value) + " грн";
}

async function requestReport(periodFrom:string,periodTo:string) {
  const response = await fetch(
    `/api/staff/reports?from=${encodeURIComponent(periodFrom)}&to=${encodeURIComponent(periodTo)}`,
    { cache:"no-store" }
  );
  const result = await response.json() as ReportData & { error?:string };
  return { response, result };
}

export default function ReportsPage() {
  const [from,setFrom] = useState(INITIAL_REPORT_PERIOD.from);
  const [to,setTo] = useState(INITIAL_REPORT_PERIOD.to);
  const [data,setData] = useState<ReportData | null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);

  async function load(periodFrom = from, periodTo = to) {
    setLoading(true);
    setError("");
    const { response, result } = await requestReport(periodFrom, periodTo);
    if (!response.ok) {
      setData(null);
      setError(result.error || "Не вдалося сформувати звіт");
      setLoading(false);
      return;
    }
    setData(result);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { from:periodFrom, to:periodTo } = INITIAL_REPORT_PERIOD;
      void requestReport(periodFrom, periodTo).then(({response,result}) => {
        if (!response.ok) {
          setData(null);
          setError(result.error || "Не вдалося сформувати звіт");
        } else {
          setData(result);
        }
        setLoading(false);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const maxDay = useMemo(() => Math.max(1, ...(data?.byDay.map((row)=>row.total) || [1])), [data]);
  const maxService = useMemo(() => Math.max(1, ...(data?.byService.map((row)=>row.count) || [1])), [data]);
  const maxEquipment = useMemo(() => Math.max(1, ...(data?.byEquipment.map((row)=>row.count) || [1])), [data]);

  return <main className="reportShell">
    <header className="reportHead">
      <div>
        <p className="eyebrow">RadiologyOS · аналітика</p>
        <h1>Управлінський звіт</h1>
        {data?.staff && <p>{data.staff.displayName || data.staff.email} · {roleLabels[data.staff.role] || data.staff.role}</p>}
      </div>
      <nav className="staffHeadActions" aria-label="Навігація персоналу">
        <Link className="button compact secondaryButton" href="/staff">Черга заявок</Link>
        <Link className="button compact" href="/">Публічний сайт</Link>
      </nav>
    </header>

    {error && !data ? <section className="accessDenied">
      <b>Захищений розділ</b>
      <p>{error}. Увійдіть через дозволений робочий обліковий запис.</p>
      <a className="button compact" href="/signin-with-chatgpt?returnTo=%2Fstaff%2Freports">Увійти для роботи</a>
    </section> : <>
      <form className="reportFilters" onSubmit={event=>{event.preventDefault();void load();}}>
        <label><span>Від</span><input type="date" value={from} onChange={event=>setFrom(event.target.value)} required/></label>
        <label><span>До</span><input type="date" value={to} onChange={event=>setTo(event.target.value)} required/></label>
        <button type="submit" disabled={loading}>{loading ? "Формування…" : "Сформувати звіт"}</button>
        {data && <a
          className="csvButton"
          href={`/api/staff/reports?from=${encodeURIComponent(data.from)}&to=${encodeURIComponent(data.to)}&format=csv`}
        >Завантажити CSV без ПІБ</a>}
      </form>
      {error && <p className="staffError" role="alert">{error}</p>}

      {data && <div className="reportContent">
        <p className="reportPeriod">Період: {data.from} — {data.to}. Дані згруповано без ПІБ і телефонів пацієнтів.</p>
        <section className="reportStats" aria-label="Ключові показники">
          <article><span>Записів</span><b>{data.summary.total}</b><small>{data.summary.cancelled} скасовано</small></article>
          <article><span>Завершено</span><b>{data.summary.completed}</b><small>з {data.summary.active} активних</small></article>
          <article><span>Протоколи готові</span><b>{data.summary.protocolsReady}</b><small>{data.summary.awaitingProtocol} очікують після дослідження</small></article>
          <article><span>Очікують оплати</span><b>{data.summary.pendingPayments}</b><small>цивільний маршрут</small></article>
          <article><span>Отримано оплат</span><b>{formatMoney(data.summary.paidRevenue)}</b><small>за позначеними оплатами</small></article>
          <article><span>Очікувана вартість</span><b>{formatMoney(data.summary.expectedRevenue)}</b><small>активні цивільні записи</small></article>
        </section>

        <section className="reportGrid">
          <article className="reportPanel widePanel">
            <div className="reportPanelHead"><h2>Навантаження за днями</h2><span>усього / завершено / дохід</span></div>
            {data.byDay.length === 0 ? <p className="emptyReport">За обраний період записів немає.</p> :
            <div className="dayReport">
              {data.byDay.map((row)=><div className="dayReportRow" key={row.date}>
                <b>{row.date}</b>
                <div className="reportBarTrack"><span style={{width:`${Math.max(3,row.total/maxDay*100)}%`}}/></div>
                <span>{row.total} / {row.completed}</span>
                <strong>{formatMoney(row.revenue)}</strong>
              </div>)}
            </div>}
          </article>

          <article className="reportPanel">
            <div className="reportPanelHead"><h2>Обладнання</h2><span>активні записи</span></div>
            {data.byEquipment.map((row)=><div className="rankRow" key={row.id}>
              <span>{row.name}</span><div className="reportBarTrack"><i style={{width:`${row.count/maxEquipment*100}%`}}/></div><b>{row.count}</b>
            </div>)}
          </article>

          <article className="reportPanel">
            <div className="reportPanelHead"><h2>Маршрути</h2><span>активні записи</span></div>
            <dl className="routeSummary">
              <div><dt>Військовий</dt><dd>{data.summary.military}</dd></div>
              <div><dt>Цивільний</dt><dd>{data.summary.civilian}</dd></div>
              <div><dt>е-Направлення очікує НСЗУ</dt><dd>{data.summary.nszuPending}</dd></div>
            </dl>
          </article>

          <article className="reportPanel widePanel">
            <div className="reportPanelHead"><h2>Популярні послуги</h2><span>активні записи</span></div>
            <div className="serviceReport">
              {data.byService.map((row)=><div className="serviceReportRow" key={row.code}>
                <span><small>Код {row.code}</small><b>{row.title}</b></span>
                <div className="reportBarTrack"><i style={{width:`${row.count/maxService*100}%`}}/></div>
                <strong>{row.count}</strong>
                <em>{formatMoney(row.revenue)}</em>
              </div>)}
            </div>
          </article>

          <article className="reportPanel widePanel">
            <div className="reportPanelHead"><h2>Джерела звернень</h2><span>без персональних даних</span></div>
            <div className="sourceChips">
              {data.bySource.map((row)=><span key={row.source}><b>{row.count}</b>{row.source}</span>)}
            </div>
          </article>
        </section>
      </div>}
    </>}
  </main>;
}
