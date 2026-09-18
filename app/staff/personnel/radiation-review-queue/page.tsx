"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type ReviewRecord = {
  personnelId:string;
  displayName:string;
  positionTitle:string;
  departmentName:string | null;
  monitoringScopeState:string;
  monitoringScopeEffectiveDate:string | null;
  monitoringScopeText:string | null;
  clearanceState:string;
  trainingState:string;
  knowledgeCheckState:string;
  dosimetryState:string;
  scopeReviewReasons:string[];
  baseReviewReasons:string[];
  policyReviewReasons:string[];
  reviewReasons:string[];
  summaryState:"recorded" | "review" | "out_of_scope";
};

type ComplianceResponse = {
  asOf?:string;
  policy?:{ id:string; effectiveFrom:string; enabled:boolean; sourceTitle:string } | null;
  records?:ReviewRecord[];
  error?:string;
};

type QueueFilter = "all" | "scope" | "base" | "policy";

function localIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function reasonCount(record:ReviewRecord, filter:QueueFilter) {
  if (filter === "scope") return record.scopeReviewReasons.length;
  if (filter === "base") return record.baseReviewReasons.length;
  if (filter === "policy") return record.policyReviewReasons.length;
  return record.reviewReasons.length;
}

function reasons(record:ReviewRecord, filter:QueueFilter) {
  if (filter === "scope") return record.scopeReviewReasons;
  if (filter === "base") return record.baseReviewReasons;
  if (filter === "policy") return record.policyReviewReasons;
  return record.reviewReasons;
}

export default function RadiationReviewQueuePage() {
  const [asOf,setAsOf] = useState("");
  const [records,setRecords] = useState<ReviewRecord[]>([]);
  const [policy,setPolicy] = useState<ComplianceResponse["policy"]>(null);
  const [filter,setFilter] = useState<QueueFilter>("all");
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");

  const load = useCallback(async(date:string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(
        `/api/staff/personnel/radiation-compliance?asOf=${encodeURIComponent(date)}`,
        { cache:"no-store" },
      );
      const data = await response.json() as ComplianceResponse;
      if (!response.ok) throw new Error(data.error || "Не вдалося завантажити чергу review");
      setRecords((data.records || []).filter((record) => record.summaryState === "review"));
      setPolicy(data.policy || null);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Не вдалося завантажити чергу review");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const today = localIsoDate();
      setAsOf(today);
      void load(today);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const queue = useMemo(
    () => records.filter((record) => reasonCount(record, filter) > 0),
    [records, filter],
  );
  const scopeCount = useMemo(() => records.filter((record) => record.scopeReviewReasons.length > 0).length, [records]);
  const baseCount = useMemo(() => records.filter((record) => record.baseReviewReasons.length > 0).length, [records]);
  const policyCount = useMemo(() => records.filter((record) => record.policyReviewReasons.length > 0).length, [records]);

  return <StaffWorkspaceShell
    active="personnel"
    title="Радіаційна безпека · черга review"
    description="Read-only робочий список персоналу, для якого зведення ДІВ уже має детерміновані причини ручної перевірки."
  >
    {error && <p className="errorBox">{error}</p>}

    <section className="financeSummary" aria-label="Черга review радіаційної безпеки">
      <article><span>У черзі</span><b>{records.length}</b><small>summaryState = review</small></article>
      <article><span>Scope</span><b>{scopeCount}</b><small>контингент потребує уточнення</small></article>
      <article><span>Базові причини</span><b>{baseCount}</b><small>допуск / навчання / знання / дозиметрія</small></article>
      <article><span>Policy review</span><b>{policyCount}</b><small>лише налаштовані review-критерії</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Дата зрізу</b><small>Черга будується з того самого read-only «Зведення ДІВ».</small></div>
        <div className="shiftPlannerToolbar">
          <input aria-label="Дата зрізу" type="date" value={asOf} onChange={(event)=>setAsOf(event.target.value)} />
          <button className="button secondary" type="button" disabled={!asOf || loading} onClick={()=>void load(asOf)}>{loading?"Оновлення…":"Оновити"}</button>
        </div>
      </header>
      <div className="shiftPlannerToolbar" aria-label="Фільтр причин review">
        <button className={`button ${filter === "all" ? "primary" : "secondary"}`} type="button" onClick={()=>setFilter("all")}>Усі review</button>
        <button className={`button ${filter === "scope" ? "primary" : "secondary"}`} type="button" onClick={()=>setFilter("scope")}>Scope</button>
        <button className={`button ${filter === "base" ? "primary" : "secondary"}`} type="button" onClick={()=>setFilter("base")}>Базові</button>
        <button className={`button ${filter === "policy" ? "primary" : "secondary"}`} type="button" onClick={()=>setFilter("policy")}>Policy</button>
      </div>
      <p className="notice">
        Це не alert, не юридичний висновок і не operational gate. Черга нічого не блокує, не змінює кадрові записи і не застосовує дозові пороги. `out_of_scope` сюди не потрапляє автоматично, бо має окремий нейтральний стан у зведенні.
      </p>
      <p className="notice">
        {policy ? <>Policy revision від <b>{policy.effectiveFrom}</b> ({policy.enabled?"увімкнена":"вимкнена"}) · {policy.sourceTitle || "джерело не вказано"}. </> : <>Effective policy на цю дату не знайдена. </>}
        <Link href="/staff/personnel/radiation-compliance">Повне зведення ДІВ</Link> · <Link href="/staff/personnel/radiation-review-policy">Політика ДІВ</Link>
      </p>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Потребує ручної перевірки</b><small>{queue.length} запис(ів) у поточному фільтрі.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Працівник</th><th>Контингент</th><th>Причини review</th><th>Джерело причини</th><th/></tr></thead>
        <tbody>{queue.map((record)=>{
          const selectedReasons = reasons(record, filter);
          const sources = [
            record.scopeReviewReasons.length ? "scope" : "",
            record.baseReviewReasons.length ? "базові реєстри" : "",
            record.policyReviewReasons.length ? "policy" : "",
          ].filter(Boolean).join(" · ");
          return <tr key={record.personnelId}>
            <td><b>{record.displayName}</b><br/><small>{record.positionTitle}{record.departmentName?` · ${record.departmentName}`:""}</small></td>
            <td><span className="statusPill">{record.monitoringScopeState}</span><br/><small>{record.monitoringScopeEffectiveDate || "—"}{record.monitoringScopeText?` · ${record.monitoringScopeText}`:""}</small></td>
            <td><b>{selectedReasons.length}</b><br/><small>{selectedReasons.join("; ")}</small></td>
            <td><small>{filter === "all" ? sources : filter}</small></td>
            <td><Link href="/staff/personnel/radiation-compliance">Перевірити у зведенні</Link></td>
          </tr>;
        })}</tbody>
      </table>{!queue.length && <p className="notice">Для поточного фільтра review-причин немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
