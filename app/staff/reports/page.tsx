"use client";

import { useEffect, useMemo, useState } from "react";
import { REPORT_TEMPLATES } from "../../../lib/reporting";
import type { ReportColumn, ReportRecord, ReportTemplateKey } from "../../../lib/reporting";
import StaffWorkspaceShell from "../workspace-shell";

type StaffInfo = { email:string; displayName:string; role:string };
type StaffOption = { email:string; displayName:string; role:string };
type Summary = {
  total:number; active:number; completed:number; cancelled:number;
  military:number; civilian:number; protocolsReady:number; awaitingProtocol:number;
  pendingPayments:number; paidRevenue:number; expectedRevenue:number; nszuPending:number;
  performed:number; regions:number;
};
type EquipmentRow = { id:string; name:string; count:number };
type ServiceRow = { code:string; title:string; count:number; revenue:number };
type DayRow = {
  date:string; total:number; completed:number; cancelled:number;
  military:number; civilian:number; revenue:number;
};
type SourceRow = { source:string; count:number };
type ExportRow = {
  id:number; requestedBy:string; requestedByName:string; reportType:ReportTemplateKey;
  rowCount:number; format:string; containsPersonalData:number; createdAt:string;
};
type ReportData = {
  from:string; to:string; template:ReportTemplateKey; summary:Summary;
  byEquipment:EquipmentRow[]; byService:ServiceRow[]; byDay:DayRow[]; bySource:SourceRow[];
  columns:ReportColumn[]; preview:ReportRecord[]; previewTotal:number;
  exportHistory:ExportRow[];
  filterOptions:{
    staff:StaffOption[];
    equipment:Array<{id:string;name:string}>;
    services:Array<{code:string;title:string}>;
  };
  staff:StaffInfo;
};

const roleLabels:Record<string,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};

function todayInKyiv() {
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(new Date());
}

const initialToday = todayInKyiv();
const initialFrom = `${initialToday.slice(0,7)}-01`;

function formatMoney(value:number) {
  return new Intl.NumberFormat("uk-UA").format(value) + " грн";
}

function formatCell(value:string | number,column:ReportColumn) {
  if (column.kind === "money" && typeof value === "number") return formatMoney(value);
  return String(value ?? "");
}

export default function ReportsPage() {
  const [from,setFrom] = useState(initialFrom);
  const [to,setTo] = useState(initialToday);
  const [template,setTemplate] = useState<ReportTemplateKey>("studies");
  const [radiologist,setRadiologist] = useState("");
  const [radiographer,setRadiographer] = useState("");
  const [equipment,setEquipment] = useState("");
  const [serviceCode,setServiceCode] = useState("");
  const [status,setStatus] = useState("");
  const [patientCategory,setPatientCategory] = useState("");
  const [protocolStatus,setProtocolStatus] = useState("");
  const [paymentStatus,setPaymentStatus] = useState("");
  const [nszuStatus,setNszuStatus] = useState("");
  const [selectedColumns,setSelectedColumns] = useState(
    REPORT_TEMPLATES.studies.columns.filter((item)=>item.default).map((item)=>item.key)
  );
  const [data,setData] = useState<ReportData | null>(null);
  const [error,setError] = useState("");
  const [authErr,setAuthErr] = useState(false);
  const [appliedQuery,setAppliedQuery] = useState("");
  const [loading,setLoading] = useState(true);

  function queryString(includeColumns = true) {
    const params = new URLSearchParams({ from,to,template });
    const optional:Record<string,string> = {
      radiologist,radiographer,equipment,serviceCode,status,patientCategory,
      protocolStatus,paymentStatus,nszuStatus,
    };
    for (const [key,value] of Object.entries(optional)) if (value) params.set(key,value);
    if (includeColumns && selectedColumns.length) params.set("columns",selectedColumns.join(","));
    return params.toString();
  }

  async function load() {
    setLoading(true);
    setError("");
    const query = queryString();
    try {
      const response = await fetch(`/api/staff/reports?${query}`,{ cache:"no-store" });
      const result = await response.json() as ReportData & { error?:string };
      if (!response.ok) {
        setData(null);
        setAuthErr(response.status === 401 || response.status === 403);
        setError(result.error || "Не вдалося сформувати звіт");
      } else {
        setData(result);
        setAppliedQuery(query);
        setAuthErr(false);
      }
    } catch {
      setError("Не вдалося сформувати звіт — перевірте зʼєднання");
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{
    const timer = window.setTimeout(()=>{ void load(); },0);
    return ()=>window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const maxDay = useMemo(()=>Math.max(1,...(data?.byDay.map((row)=>row.total) || [1])),[data]);
  const currentTemplate = REPORT_TEMPLATES[template];
  const radiologists = data?.filterOptions.staff.filter((item)=>item.role === "radiologist") || [];
  const radiographers = data?.filterOptions.staff.filter((item)=>item.role === "radiographer") || [];
  // Експорт має віддавати саме те, що показано (застосований запит), а не
  // поточні незастосовані значення форми.
  const exportHref = `/api/staff/reports/export?${appliedQuery || queryString()}`;

  function chooseTemplate(value:ReportTemplateKey) {
    setTemplate(value);
    setSelectedColumns(REPORT_TEMPLATES[value].columns.filter((item)=>item.default).map((item)=>item.key));
  }

  function toggleColumn(key:string) {
    setSelectedColumns((current)=>
      current.includes(key) ? current.filter((item)=>item !== key) : [...current,key]
    );
  }

  return <StaffWorkspaceShell
    active="reports"
    title="Звіти та аналітика"
    description="Контроль виконаних досліджень, протоколів, навантаження персоналу, обладнання та оплат."
    staffName={data?.staff.displayName || data?.staff.email}
    staffRole={data?.staff ? roleLabels[data.staff.role] || data.staff.role : undefined}
  >

    {loading && !data ? <p className="dashLoading">Завантаження звіту…</p> :
    error && !data ? (authErr ? <section className="accessDenied">
      <b>Захищений розділ</b>
      <p>{error}. Увійдіть через дозволений робочий обліковий запис.</p>
      <a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Freports">Увійти для роботи</a>
    </section> : <section className="accessDenied">
      <b>Не вдалося сформувати звіт</b>
      <p>{error}.</p>
    </section>) : <>
      <section className="reportBuilder">
        <div className="reportBuilderHead">
          <div><p className="eyebrow">Конструктор</p><h2>Оберіть потрібний реєстр</h2></div>
          <p>Усі шаблони експортуються у справжній Excel. ПІБ і телефони не включаються, але деталізовані медичні реєстри все одно потребують захищеного зберігання.</p>
        </div>
        <div className="reportTemplateTabs">
          {(Object.values(REPORT_TEMPLATES)).map((item)=><button
            type="button"
            className={template === item.key ? "active":""}
            key={item.key}
            onClick={()=>chooseTemplate(item.key)}
          ><b>{item.label}</b><span>{item.description}</span></button>)}
        </div>

        <form className="reportFilterGrid" onSubmit={event=>{event.preventDefault();void load();}}>
          <label><span>Від</span><input type="date" value={from} onChange={event=>setFrom(event.target.value)} required/></label>
          <label><span>До</span><input type="date" value={to} onChange={event=>setTo(event.target.value)} required/></label>
          <label><span>Лікар</span><select value={radiologist} onChange={event=>setRadiologist(event.target.value)}><option value="">Усі лікарі</option>{radiologists.map((item)=><option value={item.email} key={item.email}>{item.displayName || item.email}</option>)}</select></label>
          <label><span>Лаборант</span><select value={radiographer} onChange={event=>setRadiographer(event.target.value)}><option value="">Усі лаборанти</option>{radiographers.map((item)=><option value={item.email} key={item.email}>{item.displayName || item.email}</option>)}</select></label>
          <label><span>Обладнання</span><select value={equipment} onChange={event=>setEquipment(event.target.value)}><option value="">Усе обладнання</option>{data?.filterOptions.equipment.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label><span>Послуга</span><select value={serviceCode} onChange={event=>setServiceCode(event.target.value)}><option value="">Усі послуги</option>{data?.filterOptions.services.map((item)=><option value={item.code} key={item.code}>{item.code} · {item.title}</option>)}</select></label>
          <details className="advancedReportFilters">
            <summary>Додаткові фільтри</summary>
            <div>
              <label><span>Статус запису</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="">Усі</option><option value="new">Нова</option><option value="confirmed">Підтверджена</option><option value="rescheduled">Перенесена</option><option value="completed">Завершена</option><option value="cancelled">Скасована</option></select></label>
              <label><span>Маршрут</span><select value={patientCategory} onChange={event=>setPatientCategory(event.target.value)}><option value="">Усі</option><option value="military">Військовий</option><option value="civilian">Цивільний</option></select></label>
              <label><span>Протокол</span><select value={protocolStatus} onChange={event=>setProtocolStatus(event.target.value)}><option value="">Усі</option><option value="not_started">Не розпочато</option><option value="in_progress">В роботі</option><option value="ready">Готовий</option><option value="issued">Видано</option></select></label>
              <label><span>Оплата</span><select value={paymentStatus} onChange={event=>setPaymentStatus(event.target.value)}><option value="">Усі</option><option value="verification_required">Перевірка пільги</option><option value="pending">Очікує</option><option value="paid">Оплачено</option><option value="not_required">Не потрібна</option><option value="refunded">Повернено</option></select></label>
              <label><span>НСЗУ</span><select value={nszuStatus} onChange={event=>setNszuStatus(event.target.value)}><option value="">Усі</option><option value="pending">Очікує</option><option value="confirmed">Підтверджено</option><option value="rejected">Відхилено</option><option value="not_applicable">Не застосовується</option></select></label>
            </div>
          </details>
          <div className="reportFormActions">
            <button type="submit" disabled={loading}>{loading ? "Формування…" : "Застосувати фільтри"}</button>
            {data && <a className="excelButton" href={exportHref}>Завантажити Excel</a>}
          </div>
        </form>

        <div className="reportColumns">
          <div><b>Колонки звіту</b><span>{selectedColumns.length} із {currentTemplate.columns.length}</span></div>
          <div className="columnActions">
            <button type="button" onClick={()=>setSelectedColumns(currentTemplate.columns.map((item)=>item.key))}>Обрати всі</button>
            <button type="button" onClick={()=>setSelectedColumns([])}>Зняти всі</button>
          </div>
          <div className="columnChecks">{currentTemplate.columns.map((item)=><label key={item.key}>
            <input type="checkbox" checked={selectedColumns.includes(item.key)} onChange={()=>toggleColumn(item.key)}/>
            <span>{item.label}</span>
          </label>)}</div>
        </div>

        {error && <p className="staffError" role="alert">{error}</p>}
        {data && <div className="reportPreview">
          <div className="reportPreviewHead"><b>Попередній перегляд</b><span>{data.previewTotal} рядків · показано до 100</span></div>
          <div className="reportTableScroll"><table><thead><tr>{data.columns.map((item)=><th key={item.key}>{item.label}</th>)}</tr></thead>
            <tbody>{data.preview.length === 0 ? <tr><td colSpan={Math.max(1,data.columns.length)}>Даних за обраними фільтрами немає.</td></tr> :
              data.preview.map((row,index)=><tr key={index}>{data.columns.map((item)=><td key={item.key}>{formatCell(row[item.key],item)}</td>)}</tr>)}
            </tbody></table></div>
        </div>}
      </section>

      {data && <div className="reportContent">
        <section className="reportStats" aria-label="Ключові показники">
          <article><span>Записів</span><b>{data.summary.total}</b><small>{data.summary.cancelled} скасовано</small></article>
          <article><span>Фактично виконано</span><b>{data.summary.performed}</b><small>{data.summary.regions} анатомічних ділянок</small></article>
          <article><span>Протоколи готові</span><b>{data.summary.protocolsReady}</b><small>{data.summary.awaitingProtocol} очікують</small></article>
          <article><span>Очікують оплати</span><b>{data.summary.pendingPayments}</b><small>цивільний маршрут</small></article>
          <article><span>Фактично оплачено</span><b>{formatMoney(data.summary.paidRevenue)}</b><small>за позначеними оплатами</small></article>
          <article><span>Очікувана вартість</span><b>{formatMoney(data.summary.expectedRevenue)}</b><small>активні цивільні записи</small></article>
        </section>
        <section className="reportGrid">
          <article className="reportPanel widePanel">
            <div className="reportPanelHead"><h2>Навантаження за днями</h2><span>усього / завершено / дохід</span></div>
            <div className="dayReport">{data.byDay.map((row)=><div className="dayReportRow" key={row.date}>
              <b>{row.date}</b><div className="reportBarTrack"><span style={{width:`${Math.max(3,row.total/maxDay*100)}%`}}/></div>
              <span>{row.total} / {row.completed}</span><strong>{formatMoney(row.revenue)}</strong>
            </div>)}</div>
          </article>
          <article className="reportPanel">
            <div className="reportPanelHead"><h2>Обладнання</h2><span>активні записи</span></div>
            {data.byEquipment.map((row)=><div className="rankRow" key={row.id}><span>{row.name}</span><b>{row.count}</b></div>)}
          </article>
          <article className="reportPanel">
            <div className="reportPanelHead"><h2>Маршрути</h2><span>активні записи</span></div>
            <dl className="routeSummary"><div><dt>Військовий</dt><dd>{data.summary.military}</dd></div><div><dt>Цивільний</dt><dd>{data.summary.civilian}</dd></div><div><dt>НСЗУ очікує</dt><dd>{data.summary.nszuPending}</dd></div></dl>
          </article>
          <article className="reportPanel widePanel">
            <div className="reportPanelHead"><h2>Журнал експорту</h2><span>хто, коли та скільки рядків</span></div>
            <div className="exportHistory">{data.exportHistory.length === 0 ? <p>Експортів ще не було.</p> :
              data.exportHistory.map((item)=><div key={item.id}><span><b>{REPORT_TEMPLATES[item.reportType]?.label || item.reportType}</b><small>{new Date(item.createdAt).toLocaleString("uk-UA")} · {item.requestedByName}</small></span><strong>{item.rowCount} рядків · {item.format.toUpperCase()}</strong><em>{item.containsPersonalData ? "Захищений деталізований реєстр":"Агрегований звіт"}</em></div>)}
            </div>
          </article>
        </section>
      </div>}
    </>}
  </StaffWorkspaceShell>;
}
