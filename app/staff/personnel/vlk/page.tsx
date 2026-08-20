"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type PersonnelRecord = {
  id:string;
  displayName:string;
  positionTitle:string;
  departmentName?:string;
  active:number;
};

type PersonnelResponse = { records:PersonnelRecord[]; error?:string };

type VlkRecord = {
  id:string;
  examinationDate:string;
  decisionCode:string;
  decisionText:string;
  validUntil:string;
  commissionName:string;
  documentNumber:string;
  supersedesId:string | null;
  createdBy:string;
  createdAt:string;
  superseded:number;
};

type VlkResponse = {
  personnel?:{ id:string; displayName:string; positionTitle:string };
  records?:VlkRecord[];
  error?:string;
};

const DECISIONS:[string,string][] = [
  ["fit", "Придатний"],
  ["temporarily_unfit", "Тимчасово непридатний"],
  ["unfit", "Непридатний"],
  ["other", "Інше рішення"],
];

function decisionLabel(code:string) {
  return DECISIONS.find(([value]) => value === code)?.[1] || code;
}

export default function PersonnelVlkPage(){
  const [personnel,setPersonnel]=useState<PersonnelRecord[]>([]);
  const [personnelId,setPersonnelId]=useState("");
  const [records,setRecords]=useState<VlkRecord[]>([]);
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

  async function loadVlk(id:string){
    if(!id){ setRecords([]); return; }
    setLoading(true); setError("");
    try {
      const response=await fetch(`/api/staff/personnel/vlk?personnelId=${encodeURIComponent(id)}`,{cache:"no-store"});
      const body=await response.json().catch(()=>({})) as VlkResponse;
      if(!response.ok) throw new Error(body.error || "Не вдалося завантажити історію ВЛК");
      setRecords(body.records || []);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити історію ВЛК");
    } finally { setLoading(false); }
  }

  useEffect(()=>{ void loadPersonnel(); },[]);
  useEffect(()=>{ if(personnelId) void loadVlk(personnelId); },[personnelId]);

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!personnelId) return;
    const form=new FormData(event.currentTarget);
    const payload={
      personnelId,
      examinationDate:String(form.get("examinationDate") || ""),
      decisionCode:String(form.get("decisionCode") || ""),
      decisionText:String(form.get("decisionText") || ""),
      validUntil:String(form.get("validUntil") || ""),
      commissionName:String(form.get("commissionName") || ""),
      documentNumber:String(form.get("documentNumber") || ""),
      supersedesId,
    };
    setSaving(true); setError(""); setNotice("");
    try {
      const response=await fetch("/api/staff/personnel/vlk",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const body=await response.json().catch(()=>({})) as {ok?:boolean;error?:string};
      if(!response.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти рішення ВЛК");
      event.currentTarget.reset();
      setSupersedesId(null);
      setNotice(payload.supersedesId ? "Виправлення ВЛК додано без зміни попереднього запису." : "Рішення ВЛК додано до історії.");
      await loadVlk(personnelId);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти рішення ВЛК");
    } finally { setSaving(false); }
  }

  return <StaffWorkspaceShell
    active="directories"
    title="ВЛК персоналу"
    description="Окрема захищена історія рішень ВЛК. Попередні записи не редагуються і не видаляються; виправлення додається новим записом."
  >
    <section className="financeSummary" aria-label="Принципи обліку ВЛК">
      <article><span>Особа</span><b>personnelId</b><small>не логін і не телефон</small></article>
      <article><span>Історія</span><b>Append-only</b><small>без переписування минулого</small></article>
      <article><span>Дані</span><b>Мінімально</b><small>без діагнозів у кадровому реєстрі</small></article>
      <article><span>Доступ</span><b>Аудит</b><small>перегляд і внесення фіксуються</small></article>
    </section>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Працівник</b><small>Оберіть кадрову картку, для якої ведеться історія ВЛК.</small></div></header>
      <div className="shiftPlannerToolbar">
        <select value={personnelId} onChange={(event)=>{setPersonnelId(event.target.value);setSupersedesId(null);}} aria-label="Працівник">
          {!personnel.length && <option value="">Немає активних працівників</option>}
          {personnel.map((item)=><option key={item.id} value={item.id}>{item.displayName} · {item.positionTitle}</option>)}
        </select>
      </div>
    </section>

    {selected && <section className="financeJournal">
      <header className="financeToolbar"><div><b>{supersedesId ? "Виправлення рішення ВЛК" : "Нове рішення ВЛК"}</b><small>{selected.displayName} · {selected.positionTitle}</small></div>{supersedesId && <button className="button secondary" type="button" onClick={()=>setSupersedesId(null)}>Скасувати виправлення</button>}</header>
      <form className="formGrid" onSubmit={save}>
        <label>Дата ВЛК<input name="examinationDate" type="date" required /></label>
        <label>Рішення<select name="decisionCode" defaultValue="fit">{DECISIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Текст висновку<input name="decisionText" maxLength={240} placeholder="За потреби — точне формулювання рішення" /></label>
        <label>Дійсне до<input name="validUntil" type="date" /></label>
        <label>ВЛК / комісія<input name="commissionName" maxLength={200} /></label>
        <label>№ документа<input name="documentNumber" maxLength={120} /></label>
        <div><button className="button primary" type="submit" disabled={saving}>{saving ? "Зберігаємо…" : supersedesId ? "Додати виправлення" : "Додати рішення"}</button></div>
      </form>
      <p className="notice">Скан документа в цьому блоці не зберігається. Файлові вкладення будуть окремим R2-модулем з власним контролем доступу.</p>
    </section>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Історія ВЛК</b><small>Усі рішення зберігаються як окремі незмінні записи.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Дата</th><th>Рішення</th><th>Документ</th><th>Строк</th><th>Стан</th><th/></tr></thead>
        <tbody>{records.map((record)=><tr key={record.id}>
          <td><b>{record.examinationDate}</b><br/><small>{record.commissionName || "Комісію не вказано"}</small></td>
          <td><b>{decisionLabel(record.decisionCode)}</b>{record.decisionText && <><br/><small>{record.decisionText}</small></>}</td>
          <td>{record.documentNumber || "—"}</td>
          <td>{record.validUntil || "Без окремого строку"}</td>
          <td><span className={`statusPill ${record.superseded ? "" : "ok"}`}>{record.superseded ? "Виправлено" : "Чинний запис"}</span></td>
          <td>{record.superseded ? null : <button className="button secondary" type="button" onClick={()=>setSupersedesId(record.id)}>Виправити</button>}</td>
        </tr>)}</tbody>
      </table>{!records.length && <p className="notice">Рішень ВЛК для цього працівника ще немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
