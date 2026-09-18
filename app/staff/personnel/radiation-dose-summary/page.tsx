"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type DoseSummaryRecord = {
  personnelId:string;
  displayName:string;
  positionTitle:string;
  departmentName:string | null;
  monitoringScopeStatus:string | null;
  monitoringScopeText:string | null;
  monitoringScopeEffectiveDate:string | null;
  monitoringScopeState:"in_scope" | "out_of_scope" | "other" | "unclassified";
  firstPeriodStart:string | null;
  lastPeriodEnd:string | null;
  measuredCount:number;
  belowDetectionCount:number;
  missingCount:number;
  otherCount:number;
  hp10MeasuredSubtotal:number;
  hp007MeasuredSubtotal:number;
  hp3MeasuredSubtotal:number;
  recordCount:number;
  hasNonMeasuredRecords:boolean;
  numericSubtotalAvailable:boolean;
};

type DoseSummaryResponse = {
  from?:string;
  to?:string;
  scopeAsOf?:string;
  rangeBasis?:"period_end";
  subtotalBasis?:"measured_only";
  records?:DoseSummaryRecord[];
  summary?:{
    totalPersonnel:number;
    personnelWithRecords:number;
    personnelWithoutRecords:number;
    personnelWithNonMeasuredRecords:number;
    inScopeCount:number;
    outOfScopeCount:number;
    scopeReviewCount:number;
  };
  error?:string;
};

function localIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function yearStart(date:string) {
  return `${date.slice(0, 4)}-01-01`;
}

function dose(value:number, available:boolean) {
  return available ? `${String(Number(value || 0))} mSv` : "—";
}

function statusLines(record:DoseSummaryRecord) {
  const lines:string[] = [];
  if (record.measuredCount) lines.push(`measured: ${record.measuredCount}`);
  if (record.belowDetectionCount) lines.push(`< межі визначення: ${record.belowDetectionCount}`);
  if (record.missingCount) lines.push(`результат відсутній: ${record.missingCount}`);
  if (record.otherCount) lines.push(`other: ${record.otherCount}`);
  return lines.length ? lines.join(" · ") : "Записів у вибраному інтервалі немає";
}

function scopeLabel(state:DoseSummaryRecord["monitoringScopeState"]) {
  if (state === "in_scope") return "У контурі";
  if (state === "out_of_scope") return "Поза контуром";
  if (state === "other") return "Інший статус";
  return "Не класифіковано";
}

export default function RadiationDoseSummaryPage() {
  const [from,setFrom] = useState("");
  const [to,setTo] = useState("");
  const [scopeAsOf,setScopeAsOf] = useState("");
  const [records,setRecords] = useState<DoseSummaryRecord[]>([]);
  const [summary,setSummary] = useState({
    totalPersonnel:0,
    personnelWithRecords:0,
    personnelWithoutRecords:0,
    personnelWithNonMeasuredRecords:0,
    inScopeCount:0,
    outOfScopeCount:0,
    scopeReviewCount:0,
  });
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");

  const load = useCallback(async(nextFrom:string,nextTo:string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(
        `/api/staff/personnel/radiation-dose-summary?from=${encodeURIComponent(nextFrom)}&to=${encodeURIComponent(nextTo)}`,
        { cache:"no-store" },
      );
      const data = await response.json() as DoseSummaryResponse;
      if (!response.ok) throw new Error(data.error || "Не вдалося завантажити дозове зведення");
      setScopeAsOf(data.scopeAsOf || nextTo);
      setRecords(data.records || []);
      setSummary(data.summary || {
        totalPersonnel:0,
        personnelWithRecords:0,
        personnelWithoutRecords:0,
        personnelWithNonMeasuredRecords:0,
        inScopeCount:0,
        outOfScopeCount:0,
        scopeReviewCount:0,
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Не вдалося завантажити дозове зведення");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const today = localIsoDate();
      const start = yearStart(today);
      setFrom(start);
      setTo(today);
      void load(start, today);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <StaffWorkspaceShell
    active="personnel"
    title="Індивідуальна дозиметрія · дозове зведення"
    description="Read-only числовий subtotal виміряних Hp(10), Hp(0.07) та Hp(3) за вибраним інтервалом без нормативних порогів."
  >
    {error && <p className="errorBox">{error}</p>}

    <section className="financeSummary" aria-label="Дозове зведення">
      <article><span>Активний персонал</span><b>{summary.totalPersonnel}</b><small>кадрових карток</small></article>
      <article><span>Є дозиметричні записи</span><b>{summary.personnelWithRecords}</b><small>за period_end у діапазоні</small></article>
      <article><span>У контурі на кінець періоду</span><b>{summary.inScopeCount}</b><small>scope станом на {scopeAsOf || to || "—"}</small></article>
      <article><span>Scope потребує уточнення</span><b>{summary.scopeReviewCount}</b><small>other / не класифіковано</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div>
          <b>Період зведення</b>
          <small>Запис включається за датою завершення дозиметричного періоду (`period_end`).</small>
        </div>
        <div className="shiftPlannerToolbar">
          <input aria-label="Початок періоду" type="date" value={from} onChange={(event)=>setFrom(event.target.value)} />
          <input aria-label="Кінець періоду" type="date" value={to} onChange={(event)=>setTo(event.target.value)} />
          <button className="button secondary" type="button" disabled={!from || !to || loading} onClick={()=>void load(from,to)}>
            {loading?"Оновлення…":"Оновити"}
          </button>
        </div>
      </header>
      <p className="notice">
        Числовий subtotal нижче складається лише зі статусів `measured`. `below_detection` не є нульовою дозою, `missing` не означає нульове опромінення, а `other` не включається до subtotal без ручної інтерпретації первинного запису.
      </p>
      <p className="notice">
        Контингент показується лише як організаційний контекст станом на кінець вибраного періоду. `out_of_scope`, `other` або відсутність класифікації не приховують і не обнуляють історичні дозиметричні записи чи measured subtotal. <Link href="/staff/personnel/radiation-monitoring-scope">Історія контингенту</Link>
      </p>
      <p className="notice">
        Це не розрахунок нормативної річної/ковзної дози, не юридичний висновок і не alert. Тут немає dose thresholds та автоматичного блокування PACS, КТ, рентген чи booking.
      </p>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Активний персонал</b><small>Тільки unsuperseded append-only записи дозиметрії; scope не фільтрує історичні дози.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Працівник</th><th>Контингент</th><th>Покритий записами період</th><th>Статуси записів</th><th>Hp(10) subtotal</th><th>Hp(0.07) subtotal</th><th>Hp(3) subtotal</th><th/></tr></thead>
        <tbody>{records.map((record)=><tr key={record.personnelId}>
          <td><b>{record.displayName}</b><br/><small>{record.positionTitle}{record.departmentName?` · ${record.departmentName}`:""}</small></td>
          <td>
            <span className={`statusPill ${record.monitoringScopeState === "in_scope" ? "ok" : ""}`}>{scopeLabel(record.monitoringScopeState)}</span>
            <br/><small>{record.monitoringScopeEffectiveDate || "Немає effective-dated запису"}{record.monitoringScopeText?` · ${record.monitoringScopeText}`:""}</small>
          </td>
          <td>{record.firstPeriodStart && record.lastPeriodEnd ? <><b>{record.firstPeriodStart}</b> → <b>{record.lastPeriodEnd}</b></> : "—"}</td>
          <td>
            <span className={`statusPill ${record.recordCount && !record.hasNonMeasuredRecords?"ok":""}`}>
              {record.recordCount ? `${record.recordCount} запис(ів)` : "Немає записів"}
            </span>
            <br/><small>{statusLines(record)}</small>
            {record.hasNonMeasuredRecords && <><br/><small>Числовий subtotal не охоплює ненумеричні статуси.</small></>}
          </td>
          <td><b>{dose(record.hp10MeasuredSubtotal,record.numericSubtotalAvailable)}</b></td>
          <td><b>{dose(record.hp007MeasuredSubtotal,record.numericSubtotalAvailable)}</b></td>
          <td><b>{dose(record.hp3MeasuredSubtotal,record.numericSubtotalAvailable)}</b></td>
          <td><Link href="/staff/personnel/dosimetry">Первинні записи</Link></td>
        </tr>)}</tbody>
      </table>{!records.length && <p className="notice">Активних кадрових карток немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
