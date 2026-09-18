"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type PersonnelRecord = {
  id:string;
  displayName:string;
  positionTitle:string;
  active:number;
};

type PersonnelResponse = { records:PersonnelRecord[]; error?:string };

type ClearanceRecord = {
  id:string;
  effectiveDate:string;
  decisionCode:string;
  scopeText:string;
  validUntil:string;
  documentType:string;
  documentNumber:string;
  documentDate:string;
  issuedBy:string;
  note:string;
  supersedesId:string | null;
  createdBy:string;
  createdAt:string;
  superseded:number;
};

type ClearanceResponse = {
  personnel?:{ id:string; displayName:string; positionTitle:string };
  records?:ClearanceRecord[];
  error?:string;
};

const DECISIONS:[string,string][] = [
  ["authorized", "Допущено до робіт з ДІВ"],
  ["suspended", "Допуск призупинено"],
  ["revoked", "Допуск припинено"],
  ["other", "Інше рішення"],
];

function decisionLabel(code:string) {
  return DECISIONS.find(([value]) => value === code)?.[1] || code;
}

export default function PersonnelRadiationClearancePage(){
  const [personnel,setPersonnel]=useState<PersonnelRecord[]>([]);
  const [personnelId,setPersonnelId]=useState("");
  const [records,setRecords]=useState<ClearanceRecord[]>([]);
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

  async function loadClearances(id:string){
    if(!id){ setRecords([]); return; }
    setLoading(true); setError("");
    try {
      const response=await fetch(`/api/staff/personnel/radiation-clearance?personnelId=${encodeURIComponent(id)}`,{cache:"no-store"});
      const body=await response.json().catch(()=>({})) as ClearanceResponse;
      if(!response.ok) throw new Error(body.error || "Не вдалося завантажити історію допусків до ДІВ");
      setRecords(body.records || []);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити історію допусків до ДІВ");
    } finally { setLoading(false); }
  }

  useEffect(()=>{
    const timer=window.setTimeout(()=>{ void loadPersonnel(); },0);
    return ()=>window.clearTimeout(timer);
  },[]);
  useEffect(()=>{
    if(!personnelId) return;
    const timer=window.setTimeout(()=>{ void loadClearances(personnelId); },0);
    return ()=>window.clearTimeout(timer);
  },[personnelId]);

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!personnelId) return;
    const formElement=event.currentTarget;
    const form=new FormData(formElement);
    const payload={
      personnelId,
      effectiveDate:String(form.get("effectiveDate") || ""),
      decisionCode:String(form.get("decisionCode") || ""),
      scopeText:String(form.get("scopeText") || ""),
      validUntil:String(form.get("validUntil") || ""),
      documentType:String(form.get("documentType") || ""),
      documentNumber:String(form.get("documentNumber") || ""),
      documentDate:String(form.get("documentDate") || ""),
      issuedBy:String(form.get("issuedBy") || ""),
      note:String(form.get("note") || ""),
      supersedesId,
    };
    setSaving(true); setError(""); setNotice("");
    try {
      const response=await fetch("/api/staff/personnel/radiation-clearance",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const body=await response.json().catch(()=>({})) as {ok?:boolean;error?:string};
      if(!response.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти допуск до ДІВ");
      formElement.reset();
      setSupersedesId(null);
      setNotice(payload.supersedesId ? "Виправлення допуску додано без зміни попереднього запису." : "Рішення щодо допуску додано до історії.");
      await loadClearances(personnelId);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти допуск до ДІВ");
    } finally { setSaving(false); }
  }

  return <StaffWorkspaceShell
    active="personnel"
    title="Допуск персоналу до ДІВ"
    description="Окремий кадровий реєстр рішень щодо робіт з джерелами іонізуючого випромінювання. Записи незмінні; виправлення додаються новим записом."
  >
    <section className="financeSummary" aria-label="Принципи обліку допусків до ДІВ">
      <article><span>Особа</span><b>personnelId</b><small>стабільна кадрова ідентичність</small></article>
      <article><span>Історія</span><b>Append-only</b><small>накази не переписуються</small></article>
      <article><span>Scope</span><b>Окремо</b><small>обсяг дозволених робіт</small></article>
      <article><span>Доступ</span><b>Аудит</b><small>перегляд і внесення фіксуються</small></article>
    </section>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Працівник</b><small>Оберіть кадрову картку, для якої ведеться історія допусків до ДІВ.</small></div></header>
      <div className="shiftPlannerToolbar">
        <select value={personnelId} onChange={(event)=>{setPersonnelId(event.target.value);setSupersedesId(null);}} aria-label="Працівник">
          {!personnel.length && <option value="">Немає активних працівників</option>}
          {personnel.map((item)=><option key={item.id} value={item.id}>{item.displayName} · {item.positionTitle}</option>)}
        </select>
      </div>
    </section>

    {selected && <section className="financeJournal">
      <header className="financeToolbar"><div><b>{supersedesId ? "Виправлення запису допуску" : "Нове рішення щодо допуску"}</b><small>{selected.displayName} · {selected.positionTitle}</small></div>{supersedesId && <button className="button secondary" type="button" onClick={()=>setSupersedesId(null)}>Скасувати виправлення</button>}</header>
      <form className="formGrid" onSubmit={save}>
        <label>Дата набрання чинності<input name="effectiveDate" type="date" required /></label>
        <label>Рішення<select name="decisionCode" defaultValue="authorized">{DECISIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Обсяг дозволених робіт<input name="scopeText" maxLength={400} placeholder="Напр.: рентгенографія, КТ, мобільний рентген — за наказом" /></label>
        <label>Дійсне до<input name="validUntil" type="date" /></label>
        <label>Тип документа<input name="documentType" maxLength={120} placeholder="Наказ, розпорядження, протокол…" /></label>
        <label>№ документа<input name="documentNumber" maxLength={120} /></label>
        <label>Дата документа<input name="documentDate" type="date" /></label>
        <label>Ким видано<input name="issuedBy" maxLength={200} /></label>
        <label>Примітка<input name="note" maxLength={400} placeholder="Без медичних діагнозів" /></label>
        <div><button className="button primary" type="submit" disabled={saving}>{saving ? "Зберігаємо…" : supersedesId ? "Додати виправлення" : "Додати рішення"}</button></div>
      </form>
      <p className="notice">Цей реєстр фіксує кадрову підставу допуску. Навчання з радіаційної безпеки, індивідуальна дозиметрія та автоматичний operational gate будуть окремими блоками.</p>
    </section>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Історія допусків до ДІВ</b><small>Усі рішення зберігаються як окремі незмінні записи.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Дата</th><th>Рішення / scope</th><th>Документ</th><th>Строк</th><th>Версія</th><th/></tr></thead>
        <tbody>{records.map((record)=><tr key={record.id}>
          <td><b>{record.effectiveDate}</b><br/><small>{record.issuedBy || "Орган не вказано"}</small></td>
          <td><b>{decisionLabel(record.decisionCode)}</b>{record.scopeText && <><br/><small>{record.scopeText}</small></>}{record.note && <><br/><small>{record.note}</small></>}</td>
          <td>{record.documentType || "Документ"} {record.documentNumber || "—"}{record.documentDate && <><br/><small>{record.documentDate}</small></>}</td>
          <td>{record.validUntil || "Без окремого строку"}</td>
          <td><span className={`statusPill ${record.superseded ? "" : "ok"}`}>{record.superseded ? "Виправлено" : "Актуальна версія"}</span></td>
          <td>{record.superseded ? null : <button className="button secondary" type="button" onClick={()=>setSupersedesId(record.id)}>Виправити</button>}</td>
        </tr>)}</tbody>
      </table>{!records.length && <p className="notice">Записів допуску до ДІВ для цього працівника ще немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
