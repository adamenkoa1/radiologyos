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

type ScopeRecord = {
  id:string;
  effectiveDate:string;
  scopeStatus:string;
  scopeText:string;
  basisTitle:string;
  basisReference:string;
  note:string;
  supersedesId:string | null;
  createdBy:string;
  createdAt:string;
  superseded:number;
};

type ScopeResponse = {
  personnel?:{ id:string; displayName:string; positionTitle:string };
  records?:ScopeRecord[];
  error?:string;
};

const STATUSES:[string,string][] = [
  ["in_scope", "У контурі радіаційного контролю"],
  ["out_of_scope", "Поза організаційним контуром"],
  ["other", "Інший / потребує уточнення"],
];

function statusLabel(code:string) {
  return STATUSES.find(([value]) => value === code)?.[1] || code;
}

export default function PersonnelRadiationMonitoringScopePage() {
  const [personnel,setPersonnel] = useState<PersonnelRecord[]>([]);
  const [personnelId,setPersonnelId] = useState("");
  const [records,setRecords] = useState<ScopeRecord[]>([]);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [supersedesId,setSupersedesId] = useState<string | null>(null);

  const selected = useMemo(
    () => personnel.find((item)=>item.id===personnelId) || null,
    [personnel,personnelId],
  );

  async function loadPersonnel() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/staff/personnel", { cache:"no-store" });
      const body = await response.json().catch(()=>({})) as PersonnelResponse;
      if (!response.ok) throw new Error(body.error || "Не вдалося завантажити персонал");
      const rows = (body.records || []).filter((item)=>Boolean(item.active));
      setPersonnel(rows);
      setPersonnelId((current)=>current || rows[0]?.id || "");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Не вдалося завантажити персонал");
    } finally { setLoading(false); }
  }

  async function loadScope(id:string) {
    if (!id) { setRecords([]); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(
        `/api/staff/personnel/radiation-monitoring-scope?personnelId=${encodeURIComponent(id)}`,
        { cache:"no-store" },
      );
      const body = await response.json().catch(()=>({})) as ScopeResponse;
      if (!response.ok) throw new Error(body.error || "Не вдалося завантажити історію контуру контролю");
      setRecords(body.records || []);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Не вдалося завантажити історію контуру контролю");
    } finally { setLoading(false); }
  }

  useEffect(()=>{
    const timer = window.setTimeout(()=>{ void loadPersonnel(); },0);
    return ()=>window.clearTimeout(timer);
  },[]);

  useEffect(()=>{
    if (!personnelId) return;
    const timer = window.setTimeout(()=>{ void loadScope(personnelId); },0);
    return ()=>window.clearTimeout(timer);
  },[personnelId]);

  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personnelId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      personnelId,
      effectiveDate:String(form.get("effectiveDate") || ""),
      scopeStatus:String(form.get("scopeStatus") || ""),
      scopeText:String(form.get("scopeText") || ""),
      basisTitle:String(form.get("basisTitle") || ""),
      basisReference:String(form.get("basisReference") || ""),
      note:String(form.get("note") || ""),
      supersedesId,
    };

    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/personnel/radiation-monitoring-scope", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify(payload),
      });
      const body = await response.json().catch(()=>({})) as { ok?:boolean; error?:string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти запис контуру контролю");
      formElement.reset();
      setSupersedesId(null);
      setNotice(payload.supersedesId
        ? "Виправлення додано новим append-only записом."
        : "Організаційну класифікацію додано до історії.");
      await loadScope(personnelId);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Не вдалося зберегти запис контуру контролю");
    } finally { setSaving(false); }
  }

  return <StaffWorkspaceShell
    active="personnel"
    title="Контингент радіаційного контролю"
    description="Append-only організаційна історія: хто в RadiologyOS входить до контуру радіаційного review. Це не автоматична правова категоризація і не дозвіл на роботу."
  >
    <section className="financeSummary" aria-label="Принципи контуру радіаційного контролю">
      <article><span>Особа</span><b>personnelId</b><small>стабільна кадрова ідентичність</small></article>
      <article><span>Класифікація</span><b>Явна</b><small>без inference з посади чи дозиметра</small></article>
      <article><span>Історія</span><b>Append-only</b><small>виправлення новим записом</small></article>
      <article><span>Enforcement</span><b>Відсутній</b><small>жодного блокування роботи</small></article>
    </section>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Важлива межа</b><small>Цей реєстр лише задає організаційний scope для майбутніх read-only review/alerts.</small></div></header>
      <p className="notice">
        `in_scope` не є автоматичним дозволом на роботу з ДІВ, а `out_of_scope` не є юридичним або медичним звільненням від вимог. RadiologyOS не визначає цей статус за посадою, ВЛК, дозиметрією або фактом роботи — його вносить уповноважений менеджер як окремий організаційний факт.
      </p>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Працівник</b><small>Оберіть активну кадрову картку.</small></div></header>
      <div className="shiftPlannerToolbar">
        <select value={personnelId} onChange={(event)=>{setPersonnelId(event.target.value);setSupersedesId(null);}} aria-label="Працівник">
          {!personnel.length && <option value="">Немає активних працівників</option>}
          {personnel.map((item)=><option key={item.id} value={item.id}>{item.displayName} · {item.positionTitle}</option>)}
        </select>
      </div>
    </section>

    {selected && <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>{supersedesId ? "Виправлення класифікації" : "Нова класифікація"}</b><small>{selected.displayName} · {selected.positionTitle}</small></div>
        {supersedesId && <button className="button secondary" type="button" onClick={()=>setSupersedesId(null)}>Скасувати виправлення</button>}
      </header>
      <form className="formGrid" onSubmit={save}>
        <label>Дата набрання чинності<input name="effectiveDate" type="date" required /></label>
        <label>Статус<select name="scopeStatus" defaultValue="in_scope">{STATUSES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Організаційний обсяг контролю<input name="scopeText" maxLength={500} placeholder="Напр.: персонал КТ/рентген-кабінету за внутрішнім переліком" /></label>
        <label>Підстава / документ<input name="basisTitle" maxLength={240} placeholder="Наказ, перелік, внутрішня політика…" /></label>
        <label>Реквізити підстави<input name="basisReference" maxLength={500} /></label>
        <label>Примітка<input name="note" maxLength={500} placeholder="Для статусу «Інший» — обов’язково" /></label>
        <div><button className="button primary" type="submit" disabled={saving}>{saving ? "Зберігаємо…" : supersedesId ? "Додати виправлення" : "Додати запис"}</button></div>
      </form>
    </section>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Історія організаційного scope</b><small>Найновіші записи зверху; виправлені версії залишаються в історії.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Дата</th><th>Статус</th><th>Scope</th><th>Підстава</th><th>Версія</th><th/></tr></thead>
        <tbody>{records.map((record)=><tr key={record.id}>
          <td><b>{record.effectiveDate}</b><br/><small>{record.createdAt}</small></td>
          <td><b>{statusLabel(record.scopeStatus)}</b>{record.note && <><br/><small>{record.note}</small></>}</td>
          <td>{record.scopeText || "—"}</td>
          <td>{record.basisTitle || "—"}{record.basisReference && <><br/><small>{record.basisReference}</small></>}</td>
          <td><span className={`statusPill ${record.superseded ? "" : "ok"}`}>{record.superseded ? "Виправлено" : "Актуальна версія"}</span><br/><small>{record.createdBy || "—"}</small></td>
          <td>{record.superseded ? null : <button className="button secondary" type="button" onClick={()=>setSupersedesId(record.id)}>Виправити</button>}</td>
        </tr>)}</tbody>
      </table>{!records.length && <p className="notice">Класифікацію для цього працівника ще не задано.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
