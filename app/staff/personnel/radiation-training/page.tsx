"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type PersonnelRecord = { id:string; displayName:string; positionTitle:string; active:number };
type PersonnelResponse = { records:PersonnelRecord[]; error?:string };

type TrainingRecord = {
  id:string;
  trainingDate:string;
  trainingKind:string;
  resultCode:string;
  courseTitle:string;
  providerName:string;
  trainingHours:number;
  validUntil:string;
  certificateNumber:string;
  certificateDate:string;
  note:string;
  supersedesId:string | null;
  superseded:number;
};

type TrainingResponse = { records?:TrainingRecord[]; error?:string };

const KINDS:[string,string][] = [
  ["radiation_safety", "Навчання з радіаційної безпеки"],
  ["knowledge_check", "Перевірка знань"],
  ["briefing", "Інструктаж"],
  ["other", "Інше навчання"],
];

const RESULTS:[string,string][] = [
  ["completed", "Пройдено"],
  ["passed", "Складено / допущено"],
  ["failed", "Не складено"],
  ["other", "Інший результат"],
];

function kindLabel(code:string){ return KINDS.find(([value])=>value===code)?.[1] || code; }
function resultLabel(code:string){ return RESULTS.find(([value])=>value===code)?.[1] || code; }

export default function PersonnelRadiationTrainingPage(){
  const [personnel,setPersonnel]=useState<PersonnelRecord[]>([]);
  const [personnelId,setPersonnelId]=useState("");
  const [records,setRecords]=useState<TrainingRecord[]>([]);
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

  async function loadTraining(id:string){
    if(!id){ setRecords([]); return; }
    setLoading(true); setError("");
    try {
      const response=await fetch(`/api/staff/personnel/radiation-training?personnelId=${encodeURIComponent(id)}`,{cache:"no-store"});
      const body=await response.json().catch(()=>({})) as TrainingResponse;
      if(!response.ok) throw new Error(body.error || "Не вдалося завантажити історію навчання");
      setRecords(body.records || []);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити історію навчання");
    } finally { setLoading(false); }
  }

  useEffect(()=>{
    const timer=window.setTimeout(()=>{ void loadPersonnel(); },0);
    return ()=>window.clearTimeout(timer);
  },[]);
  useEffect(()=>{
    if(!personnelId) return;
    const timer=window.setTimeout(()=>{ void loadTraining(personnelId); },0);
    return ()=>window.clearTimeout(timer);
  },[personnelId]);

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!personnelId) return;
    const formElement=event.currentTarget;
    const form=new FormData(formElement);
    const payload={
      personnelId,
      trainingDate:String(form.get("trainingDate") || ""),
      trainingKind:String(form.get("trainingKind") || ""),
      resultCode:String(form.get("resultCode") || ""),
      courseTitle:String(form.get("courseTitle") || ""),
      providerName:String(form.get("providerName") || ""),
      trainingHours:Number(form.get("trainingHours") || 0),
      validUntil:String(form.get("validUntil") || ""),
      certificateNumber:String(form.get("certificateNumber") || ""),
      certificateDate:String(form.get("certificateDate") || ""),
      note:String(form.get("note") || ""),
      supersedesId,
    };
    setSaving(true); setError(""); setNotice("");
    try {
      const response=await fetch("/api/staff/personnel/radiation-training",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const body=await response.json().catch(()=>({})) as {ok?:boolean;error?:string};
      if(!response.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти навчання");
      formElement.reset();
      setSupersedesId(null);
      setNotice(payload.supersedesId ? "Виправлення запису навчання додано без зміни попереднього." : "Навчання додано до кадрової історії.");
      await loadTraining(personnelId);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти навчання");
    } finally { setSaving(false); }
  }

  return <StaffWorkspaceShell
    active="personnel"
    title="Радіаційна безпека · навчання"
    description="Історія навчання, перевірок знань та інструктажів персоналу, прив’язана до стабільного personnelId."
  >
    <section className="financeSummary" aria-label="Принципи обліку навчання">
      <article><span>Особа</span><b>personnelId</b><small>не логін працівника</small></article>
      <article><span>Історія</span><b>Append-only</b><small>сертифікати не переписуються</small></article>
      <article><span>Строк</span><b>Контрольований</b><small>дата + valid until</small></article>
      <article><span>Доступ</span><b>Аудит</b><small>перегляд і внесення фіксуються</small></article>
    </section>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Працівник</b><small>Оберіть кадрову картку для історії навчання.</small></div></header>
      <div className="shiftPlannerToolbar">
        <select value={personnelId} onChange={(event)=>{setPersonnelId(event.target.value);setSupersedesId(null);}} aria-label="Працівник">
          {!personnel.length && <option value="">Немає активних працівників</option>}
          {personnel.map((item)=><option key={item.id} value={item.id}>{item.displayName} · {item.positionTitle}</option>)}
        </select>
      </div>
    </section>

    {selected && <section className="financeJournal">
      <header className="financeToolbar"><div><b>{supersedesId ? "Виправлення запису навчання" : "Нове навчання / перевірка знань"}</b><small>{selected.displayName} · {selected.positionTitle}</small></div>{supersedesId && <button className="button secondary" type="button" onClick={()=>setSupersedesId(null)}>Скасувати виправлення</button>}</header>
      <form className="formGrid" onSubmit={save}>
        <label>Дата<input name="trainingDate" type="date" required /></label>
        <label>Вид<select name="trainingKind" defaultValue="radiation_safety">{KINDS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Результат<select name="resultCode" defaultValue="completed">{RESULTS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Назва курсу / заходу<input name="courseTitle" maxLength={240} required /></label>
        <label>Навчальний заклад / провайдер<input name="providerName" maxLength={200} /></label>
        <label>Години<input name="trainingHours" type="number" min="0" max="10000" step="1" defaultValue="0" /></label>
        <label>Дійсне до<input name="validUntil" type="date" /></label>
        <label>№ сертифіката / посвідчення<input name="certificateNumber" maxLength={120} /></label>
        <label>Дата сертифіката<input name="certificateDate" type="date" /></label>
        <label>Примітка<input name="note" maxLength={400} /></label>
        <div><button className="button primary" type="submit" disabled={saving}>{saving ? "Зберігаємо…" : supersedesId ? "Додати виправлення" : "Додати запис"}</button></div>
      </form>
      <p className="notice">Цей блок фіксує навчання та перевірку знань. Допуск до ДІВ ведеться окремо; індивідуальна дозиметрія та operational gate не змінюються цим записом.</p>
    </section>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Історія навчання</b><small>Попередні записи незмінні; виправлення створює нову версію.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Дата</th><th>Навчання</th><th>Результат</th><th>Сертифікат</th><th>Строк</th><th>Версія</th><th/></tr></thead>
        <tbody>{records.map((record)=><tr key={record.id}>
          <td><b>{record.trainingDate}</b><br/><small>{record.trainingHours ? `${record.trainingHours} год.` : "Години не вказані"}</small></td>
          <td><b>{record.courseTitle}</b><br/><small>{kindLabel(record.trainingKind)}{record.providerName ? ` · ${record.providerName}` : ""}</small></td>
          <td>{resultLabel(record.resultCode)}{record.note && <><br/><small>{record.note}</small></>}</td>
          <td>{record.certificateNumber || "—"}{record.certificateDate && <><br/><small>{record.certificateDate}</small></>}</td>
          <td>{record.validUntil || "Без окремого строку"}</td>
          <td><span className={`statusPill ${record.superseded ? "" : "ok"}`}>{record.superseded ? "Виправлено" : "Актуальна версія"}</span></td>
          <td>{record.superseded ? null : <button className="button secondary" type="button" onClick={()=>setSupersedesId(record.id)}>Виправити</button>}</td>
        </tr>)}</tbody>
      </table>{!records.length && <p className="notice">Записів навчання з радіаційної безпеки для цього працівника ще немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
