"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type PersonnelRecord = { id:string; displayName:string; positionTitle:string; active:number };
type PersonnelResponse = { records:PersonnelRecord[]; error?:string };

type DosimetryRecord = {
  id:string;
  periodStart:string;
  periodEnd:string;
  measurementStatus:string;
  dosimeterCode:string;
  hp10Msv:number;
  hp007Msv:number;
  hp3Msv:number;
  providerName:string;
  reportNumber:string;
  reportDate:string;
  note:string;
  supersedesId:string | null;
  superseded:number;
};

type DosimetryResponse = { records?:DosimetryRecord[]; error?:string };

const STATUSES:[string,string][] = [
  ["measured", "Виміряно"],
  ["below_detection", "Нижче межі визначення"],
  ["missing", "Результат відсутній"],
  ["other", "Інший статус"],
];

function statusLabel(code:string){ return STATUSES.find(([value])=>value===code)?.[1] || code; }
function doseDisplay(status:string,value:number){
  if(status==="missing") return "—";
  if(status==="below_detection") return "< межі визначення";
  return `${String(Number(value || 0))} mSv`;
}

export default function PersonnelDosimetryPage(){
  const [personnel,setPersonnel]=useState<PersonnelRecord[]>([]);
  const [personnelId,setPersonnelId]=useState("");
  const [records,setRecords]=useState<DosimetryRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [supersedesId,setSupersedesId]=useState<string | null>(null);

  const selected=useMemo(()=>personnel.find((item)=>item.id===personnelId) || null,[personnel,personnelId]);

  async function loadPersonnel(){
    setLoading(true); setError("");
    try {
      const response=await fetch("/api/staff/personnel",{cache:"no-store"});
      const body=await response.json().catch(()=>({})) as PersonnelResponse;
      if(!response.ok) throw new Error(body.error || "Не вдалося завантажити персонал");
      const rows=(body.records || []).filter((item)=>Boolean(item.active));
      setPersonnel(rows);
      setPersonnelId((current)=>current || rows[0]?.id || "");
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити персонал");
    } finally { setLoading(false); }
  }

  async function loadDosimetry(id:string){
    if(!id){ setRecords([]); return; }
    setLoading(true); setError("");
    try {
      const response=await fetch(`/api/staff/personnel/dosimetry?personnelId=${encodeURIComponent(id)}`,{cache:"no-store"});
      const body=await response.json().catch(()=>({})) as DosimetryResponse;
      if(!response.ok) throw new Error(body.error || "Не вдалося завантажити дозиметрію");
      setRecords(body.records || []);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити дозиметрію");
    } finally { setLoading(false); }
  }

  useEffect(()=>{
    const timer=window.setTimeout(()=>{ void loadPersonnel(); },0);
    return ()=>window.clearTimeout(timer);
  },[]);
  useEffect(()=>{
    if(!personnelId) return;
    const timer=window.setTimeout(()=>{ void loadDosimetry(personnelId); },0);
    return ()=>window.clearTimeout(timer);
  },[personnelId]);

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!personnelId) return;
    const formElement=event.currentTarget;
    const form=new FormData(formElement);
    const payload={
      personnelId,
      periodStart:String(form.get("periodStart") || ""),
      periodEnd:String(form.get("periodEnd") || ""),
      measurementStatus:String(form.get("measurementStatus") || ""),
      dosimeterCode:String(form.get("dosimeterCode") || ""),
      hp10Msv:Number(form.get("hp10Msv") || 0),
      hp007Msv:Number(form.get("hp007Msv") || 0),
      hp3Msv:Number(form.get("hp3Msv") || 0),
      providerName:String(form.get("providerName") || ""),
      reportNumber:String(form.get("reportNumber") || ""),
      reportDate:String(form.get("reportDate") || ""),
      note:String(form.get("note") || ""),
      supersedesId,
    };
    setSaving(true); setError(""); setNotice("");
    try {
      const response=await fetch("/api/staff/personnel/dosimetry",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const body=await response.json().catch(()=>({})) as {ok?:boolean;error?:string};
      if(!response.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти дозиметрію");
      formElement.reset();
      setSupersedesId(null);
      setNotice(payload.supersedesId ? "Виправлення дозиметрії додано без зміни попереднього запису." : "Результат дозиметрії додано до історії.");
      await loadDosimetry(personnelId);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти дозиметрію");
    } finally { setSaving(false); }
  }

  return <StaffWorkspaceShell
    active="directories"
    title="Індивідуальна дозиметрія"
    description="Захищена append-only історія індивідуального дозиметричного контролю, прив’язана до стабільного personnelId."
  >
    <section className="financeSummary" aria-label="Принципи дозиметричного обліку">
      <article><span>Особа</span><b>personnelId</b><small>стабільна кадрова ідентичність</small></article>
      <article><span>Доза</span><b>Hp</b><small>10 · 0.07 · 3, mSv</small></article>
      <article><span>Історія</span><b>Append-only</b><small>результати не переписуються</small></article>
      <article><span>Доступ</span><b>Аудит</b><small>без доз у audit details</small></article>
    </section>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Працівник</b><small>Оберіть кадрову картку для історії індивідуальної дозиметрії.</small></div></header>
      <div className="shiftPlannerToolbar">
        <select value={personnelId} onChange={(event)=>{setPersonnelId(event.target.value);setSupersedesId(null);}} aria-label="Працівник">
          {!personnel.length && <option value="">Немає активних працівників</option>}
          {personnel.map((item)=><option key={item.id} value={item.id}>{item.displayName} · {item.positionTitle}</option>)}
        </select>
      </div>
    </section>

    {selected && <section className="financeJournal">
      <header className="financeToolbar"><div><b>{supersedesId ? "Виправлення дозиметричного запису" : "Новий результат дозиметрії"}</b><small>{selected.displayName} · {selected.positionTitle}</small></div>{supersedesId && <button className="button secondary" type="button" onClick={()=>setSupersedesId(null)}>Скасувати виправлення</button>}</header>
      <form className="formGrid" onSubmit={save}>
        <label>Початок періоду<input name="periodStart" type="date" required /></label>
        <label>Кінець періоду<input name="periodEnd" type="date" required /></label>
        <label>Статус<select name="measurementStatus" defaultValue="measured">{STATUSES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Код дозиметра<input name="dosimeterCode" maxLength={120} /></label>
        <label>Hp(10), mSv<input name="hp10Msv" type="number" min="0" step="any" defaultValue="0" /></label>
        <label>Hp(0.07), mSv<input name="hp007Msv" type="number" min="0" step="any" defaultValue="0" /></label>
        <label>Hp(3), mSv<input name="hp3Msv" type="number" min="0" step="any" defaultValue="0" /></label>
        <label>Лабораторія / провайдер<input name="providerName" maxLength={200} /></label>
        <label>№ звіту<input name="reportNumber" maxLength={120} /></label>
        <label>Дата звіту<input name="reportDate" type="date" /></label>
        <label>Примітка<input name="note" maxLength={400} /></label>
        <div><button className="button primary" type="submit" disabled={saving}>{saving ? "Зберігаємо…" : supersedesId ? "Додати виправлення" : "Додати результат"}</button></div>
      </form>
      <p className="notice">Цей реєстр зберігає первинні результати індивідуального контролю. Розрахунок річної/ковзної дози, пороги, alerts і автоматичне обмеження роботи будуть окремим compliance-блоком.</p>
    </section>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Історія дозиметрії</b><small>Попередні результати незмінні; виправлення створює новий запис.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Період</th><th>Статус / дозиметр</th><th>Hp(10)</th><th>Hp(0.07)</th><th>Hp(3)</th><th>Звіт</th><th>Версія</th><th/></tr></thead>
        <tbody>{records.map((record)=><tr key={record.id}>
          <td><b>{record.periodStart}</b><br/><small>до {record.periodEnd}</small></td>
          <td><b>{statusLabel(record.measurementStatus)}</b><br/><small>{record.dosimeterCode || "Дозиметр не вказано"}</small></td>
          <td>{doseDisplay(record.measurementStatus,record.hp10Msv)}</td>
          <td>{doseDisplay(record.measurementStatus,record.hp007Msv)}</td>
          <td>{doseDisplay(record.measurementStatus,record.hp3Msv)}</td>
          <td>{record.reportNumber || "—"}{record.reportDate && <><br/><small>{record.reportDate}</small></>}{record.providerName && <><br/><small>{record.providerName}</small></>}{record.note && <><br/><small>{record.note}</small></>}</td>
          <td><span className={`statusPill ${record.superseded ? "" : "ok"}`}>{record.superseded ? "Виправлено" : "Актуальна версія"}</span></td>
          <td>{record.superseded ? null : <button className="button secondary" type="button" onClick={()=>setSupersedesId(record.id)}>Виправити</button>}</td>
        </tr>)}</tbody>
      </table>{!records.length && <p className="notice">Записів індивідуальної дозиметрії для цього працівника ще немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
