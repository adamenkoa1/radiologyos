"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type AppliedPolicy = {
  id:string;
  effectiveFrom:string;
  enabled:boolean;
  requireClearanceValidUntil:boolean;
  trainingMaxAgeDays:number | null;
  knowledgeCheckMaxAgeDays:number | null;
  dosimetryMaxAgeDays:number | null;
  sourceTitle:string;
  sourceReference:string;
};

type ComplianceRecord = {
  personnelId:string;
  displayName:string;
  positionTitle:string;
  departmentName:string | null;
  monitoringScopeStatus:string | null;
  monitoringScopeEffectiveDate:string | null;
  monitoringScopeText:string | null;
  monitoringScopeBasisTitle:string | null;
  monitoringScopeState:"in_scope" | "out_of_scope" | "review" | "unclassified";
  clearanceState:string;
  clearanceEffectiveDate:string | null;
  clearanceValidUntil:string | null;
  clearanceDocumentNumber:string | null;
  trainingState:string;
  trainingDate:string | null;
  trainingValidUntil:string | null;
  trainingCourseTitle:string | null;
  knowledgeCheckState:string;
  knowledgeDate:string | null;
  knowledgeValidUntil:string | null;
  knowledgeCourseTitle:string | null;
  dosimetryState:string;
  dosimetryPeriodStart:string | null;
  dosimetryPeriodEnd:string | null;
  dosimetryReportNumber:string | null;
  scopeReviewReasons:string[];
  baseReviewReasons:string[];
  policyReviewReasons:string[];
  reviewReasons:string[];
  summaryState:"recorded" | "review" | "out_of_scope";
};

type ComplianceSummary = {
  total:number;
  inScopeCount:number;
  outOfScopeCount:number;
  scopeReviewCount:number;
  reviewCount:number;
  recordedCount:number;
  policyReviewCount:number;
};

type ComplianceResponse = {
  asOf?:string;
  policy?:AppliedPolicy | null;
  records?:ComplianceRecord[];
  summary?:ComplianceSummary;
  error?:string;
};

const EMPTY_SUMMARY:ComplianceSummary = {
  total:0,
  inScopeCount:0,
  outOfScopeCount:0,
  scopeReviewCount:0,
  reviewCount:0,
  recordedCount:0,
  policyReviewCount:0,
};

function localIsoDate(){
  const now=new Date();
  const local=new Date(now.getTime()-now.getTimezoneOffset()*60_000);
  return local.toISOString().slice(0,10);
}

function policyCriterion(value:number | null,label:string){
  return value==null ? `${label}: не налаштовано` : `${label}: ${value} дн.`;
}

const CLEARANCE_LABELS:Record<string,string>={
  authorized:"Чинний запис",
  authorized_unknown_expiry:"Строк не вказано",
  expired:"Строк минув",
  suspended:"Призупинено",
  revoked:"Відкликано",
  review:"Перевірити",
  missing:"Немає запису",
};
const TRAINING_LABELS:Record<string,string>={
  current:"Чинний запис",
  unknown_expiry:"Строк не вказано",
  expired:"Строк минув",
  failed:"Не пройдено",
  review:"Перевірити",
  missing:"Немає запису",
};
const DOSIMETRY_LABELS:Record<string,string>={
  measured:"Виміряно",
  below_detection:"Нижче межі визначення",
  missing_result:"Результат відсутній",
  review:"Перевірити",
  missing:"Немає запису",
};
const SCOPE_LABELS:Record<ComplianceRecord["monitoringScopeState"],string>={
  in_scope:"У контурі",
  out_of_scope:"Поза контуром",
  review:"Уточнити",
  unclassified:"Не визначено",
};

function goodState(kind:"clearance"|"training"|"dosimetry",state:string){
  if(kind==="clearance") return state==="authorized";
  if(kind==="training") return state==="current";
  return state==="measured" || state==="below_detection";
}

function Status({kind,state}:{kind:"clearance"|"training"|"dosimetry";state:string}){
  const labels=kind==="clearance"?CLEARANCE_LABELS:kind==="training"?TRAINING_LABELS:DOSIMETRY_LABELS;
  return <span className={`statusPill ${goodState(kind,state)?"ok":""}`}>{labels[state] || state}</span>;
}

function ScopeStatus({record}:{record:ComplianceRecord}){
  const good=record.monitoringScopeState==="in_scope";
  return <>
    <span className={`statusPill ${good?"ok":""}`}>{SCOPE_LABELS[record.monitoringScopeState]}</span>
    {record.monitoringScopeEffectiveDate && <><br/><small>з {record.monitoringScopeEffectiveDate}</small></>}
    {record.monitoringScopeText && <><br/><small>{record.monitoringScopeText}</small></>}
    {record.monitoringScopeBasisTitle && <><br/><small>{record.monitoringScopeBasisTitle}</small></>}
    <br/><Link href="/staff/personnel/radiation-monitoring-scope">Історія scope</Link>
  </>;
}

function NotEvaluated({scope}:{scope:ComplianceRecord["monitoringScopeState"]}){
  return <><span className="statusPill">Не оцінюється</span><br/><small>{scope==="out_of_scope"?"Працівник поза організаційним контуром":"Спочатку уточніть контур радіаційного контролю"}</small></>;
}

export default function RadiationCompliancePage(){
  const [asOf,setAsOf]=useState("");
  const [policy,setPolicy]=useState<AppliedPolicy | null>(null);
  const [records,setRecords]=useState<ComplianceRecord[]>([]);
  const [summary,setSummary]=useState<ComplianceSummary>(EMPTY_SUMMARY);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  const load=useCallback(async(date:string)=>{
    setLoading(true); setError("");
    try{
      const response=await fetch(`/api/staff/personnel/radiation-compliance?asOf=${encodeURIComponent(date)}`,{cache:"no-store"});
      const data=await response.json() as ComplianceResponse;
      if(!response.ok) throw new Error(data.error || "Не вдалося завантажити зведення");
      setPolicy(data.policy || null);
      setRecords(data.records || []);
      setSummary(data.summary || EMPTY_SUMMARY);
    }catch(value){
      setError(value instanceof Error?value.message:"Не вдалося завантажити зведення");
    }finally{ setLoading(false); }
  },[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      const date=localIsoDate();
      setAsOf(date);
      void load(date);
    },0);
    return ()=>window.clearTimeout(timer);
  },[load]);

  return <StaffWorkspaceShell
    active="personnel"
    title="Радіаційна безпека · зведення"
    description="Read-only проекція організаційного scope, допуску до ДІВ, навчання, перевірки знань та останнього стану індивідуальної дозиметрії."
  >
    {error && <p className="errorBox">{error}</p>}

    <section className="financeSummary" aria-label="Стан даних радіаційної безпеки">
      <article><span>Активний персонал</span><b>{summary.total}</b><small>усі картки показані для backfill</small></article>
      <article><span>У контурі</span><b>{summary.inScopeCount}</b><small>оцінюються safety-реєстри</small></article>
      <article><span>Потребує перевірки</span><b>{summary.reviewCount}</b><small>включно з невизначеним scope</small></article>
      <article><span>Поза контуром</span><b>{summary.outOfScopeCount}</b><small>окремий нейтральний стан</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Дата зрізу</b><small>Майбутні scope-записи, кадрові записи й policy revisions не включаються.</small></div>
        <div className="shiftPlannerToolbar">
          <input aria-label="Дата зрізу" type="date" value={asOf} onChange={(event)=>setAsOf(event.target.value)} />
          <button className="button secondary" type="button" disabled={!asOf || loading} onClick={()=>void load(asOf)}>{loading?"Оновлення…":"Оновити"}</button>
        </div>
      </header>
      <p className="notice">
        Safety-оцінка допуску, навчання, перевірки знань і дозиметрії виконується лише для працівників зі статусом `in_scope`. `out_of_scope` — це тільки організаційна класифікація RadiologyOS, не юридичне чи медичне звільнення від вимог. Невизначений або `other` scope не генерує фальшивих «відсутній допуск/дозиметрія» — спочатку потрібно уточнити контур.
      </p>
      <p className="notice">Це інформаційне зведення, а не автоматичне рішення про допуск до роботи. Воно не застосовує дозові пороги, не створює alerts і не блокує PACS, КТ, рентген або запис пацієнтів.</p>
      {policy ? <p className="notice">
        Застосована policy revision від <b>{policy.effectiveFrom}</b>: {policy.enabled?"увімкнена":"вимкнена"}. {policy.sourceTitle || "Джерело не вказано"}. {policy.requireClearanceValidUntil?"Строк дії допуску — критерій review. ":""}{policyCriterion(policy.trainingMaxAgeDays,"Навчання")} · {policyCriterion(policy.knowledgeCheckMaxAgeDays,"Перевірка знань")} · {policyCriterion(policy.dosimetryMaxAgeDays,"Дозиметрія")}. Policy застосовується лише до `in_scope`. <Link href="/staff/personnel/radiation-review-policy">Історія політики</Link>
      </p> : <p className="notice">Станом на {asOf || "обрану дату"} policy revision ще не набула чинності. Для `in_scope` застосовуються лише базові детерміновані safety-signals. <Link href="/staff/personnel/radiation-review-policy">Політика ДІВ</Link></p>}
      <p className="notice">Scope потребує уточнення: <b>{summary.scopeReviewCount}</b>. Policy-review серед `in_scope`: <b>{summary.policyReviewCount}</b>. Без очевидних зауважень серед `in_scope`: <b>{summary.recordedCount}</b>.</p>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Активний персонал</b><small>Показані всі активні картки для безпечного backfill організаційного scope.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Працівник</th><th>Контур</th><th>Допуск до ДІВ</th><th>Навчання</th><th>Перевірка знань</th><th>Дозиметрія</th><th>Зведення</th></tr></thead>
        <tbody>{records.map((record)=>{
          const evaluate=record.monitoringScopeState==="in_scope";
          return <tr key={record.personnelId}>
            <td><b>{record.displayName}</b><br/><small>{record.positionTitle}{record.departmentName?` · ${record.departmentName}`:""}</small></td>
            <td><ScopeStatus record={record}/></td>
            <td>{evaluate ? <><Status kind="clearance" state={record.clearanceState}/><br/><small>{record.clearanceEffectiveDate || "—"}{record.clearanceValidUntil?` → ${record.clearanceValidUntil}`:""}{record.clearanceDocumentNumber?` · № ${record.clearanceDocumentNumber}`:""}</small><br/><Link href="/staff/personnel/radiation-clearance">Історія</Link></> : <NotEvaluated scope={record.monitoringScopeState}/>}</td>
            <td>{evaluate ? <><Status kind="training" state={record.trainingState}/><br/><small>{record.trainingDate || "—"}{record.trainingValidUntil?` → ${record.trainingValidUntil}`:""}{record.trainingCourseTitle?` · ${record.trainingCourseTitle}`:""}</small><br/><Link href="/staff/personnel/radiation-training">Історія</Link></> : <NotEvaluated scope={record.monitoringScopeState}/>}</td>
            <td>{evaluate ? <><Status kind="training" state={record.knowledgeCheckState}/><br/><small>{record.knowledgeDate || "—"}{record.knowledgeValidUntil?` → ${record.knowledgeValidUntil}`:""}{record.knowledgeCourseTitle?` · ${record.knowledgeCourseTitle}`:""}</small></> : <NotEvaluated scope={record.monitoringScopeState}/>}</td>
            <td>{evaluate ? <><Status kind="dosimetry" state={record.dosimetryState}/><br/><small>{record.dosimetryPeriodStart && record.dosimetryPeriodEnd?`${record.dosimetryPeriodStart} → ${record.dosimetryPeriodEnd}`:"—"}{record.dosimetryReportNumber?` · звіт № ${record.dosimetryReportNumber}`:""}</small><br/><Link href="/staff/personnel/dosimetry">Історія</Link></> : <NotEvaluated scope={record.monitoringScopeState}/>}</td>
            <td>{record.summaryState==="out_of_scope"
              ? <><span className="statusPill">Поза контуром</span><br/><small>Safety-реєстри тут не оцінюються. Це не юридичне звільнення.</small></>
              : record.reviewReasons.length
                ? <><span className="statusPill">Потребує перевірки</span><br/><small>{record.reviewReasons.join("; ")}</small>{record.policyReviewReasons.length>0 && <><br/><small><b>Policy review:</b> {record.policyReviewReasons.join("; ")}</small></>}</>
                : <><span className="statusPill ok">Без очевидних зауважень</span><br/><small>Лише для `in_scope`, за даними реєстрів і review-критеріїв, без enforcement.</small></>}
            </td>
          </tr>;
        })}</tbody>
      </table>{!records.length && <p className="notice">Активних кадрових карток немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
