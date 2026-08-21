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
  baseReviewReasons:string[];
  policyReviewReasons:string[];
  reviewReasons:string[];
  summaryState:"recorded" | "review";
};

type ComplianceResponse = {
  asOf?:string;
  policy?:AppliedPolicy | null;
  records?:ComplianceRecord[];
  summary?:{total:number;reviewCount:number;recordedCount:number;policyReviewCount:number};
  error?:string;
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

function goodState(kind:"clearance"|"training"|"dosimetry",state:string){
  if(kind==="clearance") return state==="authorized";
  if(kind==="training") return state==="current";
  return state==="measured" || state==="below_detection";
}

function Status({kind,state}:{kind:"clearance"|"training"|"dosimetry";state:string}){
  const labels=kind==="clearance"?CLEARANCE_LABELS:kind==="training"?TRAINING_LABELS:DOSIMETRY_LABELS;
  return <span className={`statusPill ${goodState(kind,state)?"ok":""}`}>{labels[state] || state}</span>;
}

export default function RadiationCompliancePage(){
  const [asOf,setAsOf]=useState("");
  const [policy,setPolicy]=useState<AppliedPolicy | null>(null);
  const [records,setRecords]=useState<ComplianceRecord[]>([]);
  const [summary,setSummary]=useState({total:0,reviewCount:0,recordedCount:0,policyReviewCount:0});
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
      setSummary(data.summary || {total:0,reviewCount:0,recordedCount:0,policyReviewCount:0});
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
    active="directories"
    title="Радіаційна безпека · зведення"
    description="Read-only проекція кадрових фактів: допуск до ДІВ, навчання, перевірка знань та останній стан індивідуальної дозиметрії."
  >
    {error && <p className="errorBox">{error}</p>}

    <section className="financeSummary" aria-label="Стан даних радіаційної безпеки">
      <article><span>Активний персонал</span><b>{summary.total}</b><small>у кадровому довіднику</small></article>
      <article><span>Без очевидних зауважень</span><b>{summary.recordedCount}</b><small>за наявними даними</small></article>
      <article><span>Потребує перевірки</span><b>{summary.reviewCount}</b><small>не означає автоматичну заборону</small></article>
      <article><span>За policy-критеріями</span><b>{summary.policyReviewCount}</b><small>інформаційний review, не alert</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Дата зрізу</b><small>Майбутні кадрові записи й майбутні policy revisions не включаються.</small></div>
        <div className="shiftPlannerToolbar">
          <input aria-label="Дата зрізу" type="date" value={asOf} onChange={(event)=>setAsOf(event.target.value)} />
          <button className="button secondary" type="button" disabled={!asOf || loading} onClick={()=>void load(asOf)}>{loading?"Оновлення…":"Оновити"}</button>
        </div>
      </header>
      <p className="notice">Це інформаційне зведення, а не автоматичне рішення про допуск до роботи. Воно не застосовує дозові пороги, не створює alerts і не блокує PACS, КТ, рентген або запис пацієнтів.</p>
      {policy ? <p className="notice">
        Застосована policy revision від <b>{policy.effectiveFrom}</b>: {policy.enabled?"увімкнена":"вимкнена"}. {policy.sourceTitle || "Джерело не вказано"}. {policy.requireClearanceValidUntil?"Строк дії допуску — критерій review. ":""}{policyCriterion(policy.trainingMaxAgeDays,"Навчання")} · {policyCriterion(policy.knowledgeCheckMaxAgeDays,"Перевірка знань")} · {policyCriterion(policy.dosimetryMaxAgeDays,"Дозиметрія")}. <Link href="/staff/personnel/radiation-review-policy">Історія політики</Link>
      </p> : <p className="notice">Станом на {asOf || "обрану дату"} policy revision ще не набула чинності. Застосовуються лише базові детерміновані safety-signals. <Link href="/staff/personnel/radiation-review-policy">Політика ДІВ</Link></p>}
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Активний персонал</b><small>Показані останні несуперечливі append-only записи станом на обрану дату.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Працівник</th><th>Допуск до ДІВ</th><th>Навчання</th><th>Перевірка знань</th><th>Дозиметрія</th><th>Зведення</th></tr></thead>
        <tbody>{records.map((record)=><tr key={record.personnelId}>
          <td><b>{record.displayName}</b><br/><small>{record.positionTitle}{record.departmentName?` · ${record.departmentName}`:""}</small></td>
          <td><Status kind="clearance" state={record.clearanceState}/><br/><small>{record.clearanceEffectiveDate || "—"}{record.clearanceValidUntil?` → ${record.clearanceValidUntil}`:""}{record.clearanceDocumentNumber?` · № ${record.clearanceDocumentNumber}`:""}</small><br/><Link href="/staff/personnel/radiation-clearance">Історія</Link></td>
          <td><Status kind="training" state={record.trainingState}/><br/><small>{record.trainingDate || "—"}{record.trainingValidUntil?` → ${record.trainingValidUntil}`:""}{record.trainingCourseTitle?` · ${record.trainingCourseTitle}`:""}</small><br/><Link href="/staff/personnel/radiation-training">Історія</Link></td>
          <td><Status kind="training" state={record.knowledgeCheckState}/><br/><small>{record.knowledgeDate || "—"}{record.knowledgeValidUntil?` → ${record.knowledgeValidUntil}`:""}{record.knowledgeCourseTitle?` · ${record.knowledgeCourseTitle}`:""}</small></td>
          <td><Status kind="dosimetry" state={record.dosimetryState}/><br/><small>{record.dosimetryPeriodStart && record.dosimetryPeriodEnd?`${record.dosimetryPeriodStart} → ${record.dosimetryPeriodEnd}`:"—"}{record.dosimetryReportNumber?` · звіт № ${record.dosimetryReportNumber}`:""}</small><br/><Link href="/staff/personnel/dosimetry">Історія</Link></td>
          <td>{record.reviewReasons.length ? <><span className="statusPill">Потребує перевірки</span><br/><small>{record.reviewReasons.join("; ")}</small>{record.policyReviewReasons.length>0 && <><br/><small><b>Policy review:</b> {record.policyReviewReasons.join("; ")}</small></>}</> : <><span className="statusPill ok">Без очевидних зауважень</span><br/><small>Лише за даними реєстрів і налаштованих review-критеріїв, без enforcement.</small></>}</td>
        </tr>)}</tbody>
      </table>{!records.length && <p className="notice">Активних кадрових карток немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
