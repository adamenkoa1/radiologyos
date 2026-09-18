"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type PolicyRevision = {
  id:string;
  effectiveFrom:string;
  enabled:number;
  requireClearanceValidUntil:number;
  trainingMaxAgeDays:number | null;
  knowledgeCheckMaxAgeDays:number | null;
  dosimetryMaxAgeDays:number | null;
  sourceTitle:string;
  sourceReference:string;
  note:string;
  supersedesId:string | null;
  createdBy:string;
  createdAt:string;
  superseded:number;
};

type PolicyResponse = {
  revisions?:PolicyRevision[];
  currentLeaf?:PolicyRevision | null;
  canManage?:boolean;
  error?:string;
};

function localIsoDate(){
  const now=new Date();
  const local=new Date(now.getTime()-now.getTimezoneOffset()*60_000);
  return local.toISOString().slice(0,10);
}

function criterion(value:number | null,label:string){
  return value==null ? `${label}: не налаштовано` : `${label}: ${value} дн.`;
}

export default function RadiationReviewPolicyPage(){
  const [revisions,setRevisions]=useState<PolicyRevision[]>([]);
  const [currentLeaf,setCurrentLeaf]=useState<PolicyRevision | null>(null);
  const [canManage,setCanManage]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  const load=useCallback(async()=>{
    setLoading(true); setError("");
    try{
      const response=await fetch("/api/staff/personnel/radiation-review-policy",{cache:"no-store"});
      const data=await response.json() as PolicyResponse;
      if(!response.ok) throw new Error(data.error || "Не вдалося завантажити політику");
      setRevisions(data.revisions || []);
      setCurrentLeaf(data.currentLeaf || null);
      setCanManage(data.canManage === true);
    }catch(value){ setError(value instanceof Error?value.message:"Не вдалося завантажити політику"); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{ void load(); },0);
    return ()=>window.clearTimeout(timer);
  },[load]);

  const nextEffectiveFrom=useMemo(()=>currentLeaf?.effectiveFrom || localIsoDate(),[currentLeaf]);

  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!canManage) return;
    setSaving(true); setError(""); setNotice("");
    const form=event.currentTarget;
    const fd=new FormData(form);
    const numeric=(name:string)=>{
      const value=String(fd.get(name) || "").trim();
      return value ? Number(value) : null;
    };
    try{
      const response=await fetch("/api/staff/personnel/radiation-review-policy",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          effectiveFrom:String(fd.get("effectiveFrom") || ""),
          enabled:fd.get("enabled")==="on",
          requireClearanceValidUntil:fd.get("requireClearanceValidUntil")==="on",
          trainingMaxAgeDays:numeric("trainingMaxAgeDays"),
          knowledgeCheckMaxAgeDays:numeric("knowledgeCheckMaxAgeDays"),
          dosimetryMaxAgeDays:numeric("dosimetryMaxAgeDays"),
          sourceTitle:String(fd.get("sourceTitle") || ""),
          sourceReference:String(fd.get("sourceReference") || ""),
          note:String(fd.get("note") || ""),
          supersedesId:currentLeaf?.id || null,
        }),
      });
      const data=await response.json() as {error?:string};
      if(!response.ok) throw new Error(data.error || "Не вдалося зберегти ревізію");
      form.reset();
      setNotice("Нову append-only ревізію політики додано.");
      await load();
    }catch(value){ setError(value instanceof Error?value.message:"Не вдалося зберегти ревізію"); }
    finally{ setSaving(false); }
  }

  return <StaffWorkspaceShell
    active="personnel"
    title="Політика ДІВ · критерії review"
    description="Append-only історія організаційних критеріїв для майбутніх alerts і ручної перевірки даних радіаційної безпеки."
  >
    {error && <p className="errorBox">{error}</p>}
    {notice && <p className="notice">{notice}</p>}

    <section className="financeSummary" aria-label="Принципи політики ДІВ">
      <article><span>За замовчуванням</span><b>Вимкнено</b><small>без прихованих нормативів</small></article>
      <article><span>Історія</span><b>Append-only</b><small>старі ревізії не редагуються</small></article>
      <article><span>Результат</span><b>Review criteria</b><small>не юридичний висновок</small></article>
      <article><span>Enforcement</span><b>Відсутній</b><small>PACS/КТ/рентген не блокуються</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Важлива межа</b><small>У цьому модулі немає вбудованих законодавчих чисел або дозових порогів.</small></div></header>
      <p className="notice">Строки нижче — конфігуровані критерії для позначки «потребує перевірки». Вони не є автоматично нормативними лімітами, не визначають придатність працівника і не блокують PACS, КТ, рентген чи booking. Дозові Hp(10)/Hp(0.07)/Hp(3) thresholds тут навмисно не задаються до появи окремої моделі періоду агрегації та перевіреного нормативного джерела.</p>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>{currentLeaf?"Нова ревізія політики":"Перша ревізія політики"}</b><small>{canManage?"Форма успадковує поточні значення; змініть лише потрібне. Старі записи не переписуються.":"Перегляд доступний; змінювати організаційну політику може лише адміністратор."}</small></div></header>
      {canManage ? <form className="formGrid" onSubmit={save} key={currentLeaf?.id || "root"}>
        <label>Дата набрання чинності<input name="effectiveFrom" type="date" required defaultValue={nextEffectiveFrom} min={currentLeaf?.effectiveFrom || undefined}/></label>
        <label><input name="enabled" type="checkbox" defaultChecked={Boolean(currentLeaf?.enabled)}/> Увімкнути критерії review</label>
        <label><input name="requireClearanceValidUntil" type="checkbox" defaultChecked={Boolean(currentLeaf?.requireClearanceValidUntil)}/> Вимагати вказаний строк дії допуску до ДІВ</label>
        <label>Навчання: review після, днів<input name="trainingMaxAgeDays" type="number" min="1" max="36500" step="1" placeholder="не налаштовано" defaultValue={currentLeaf?.trainingMaxAgeDays ?? ""}/></label>
        <label>Перевірка знань: review після, днів<input name="knowledgeCheckMaxAgeDays" type="number" min="1" max="36500" step="1" placeholder="не налаштовано" defaultValue={currentLeaf?.knowledgeCheckMaxAgeDays ?? ""}/></label>
        <label>Дозиметрія: review після останнього періоду, днів<input name="dosimetryMaxAgeDays" type="number" min="1" max="36500" step="1" placeholder="не налаштовано" defaultValue={currentLeaf?.dosimetryMaxAgeDays ?? ""}/></label>
        <label>Назва джерела / внутрішнього документа<input name="sourceTitle" maxLength={240} placeholder="обов’язково, якщо політика увімкнена" defaultValue={currentLeaf?.sourceTitle || ""}/></label>
        <label>Посилання / реквізити джерела<input name="sourceReference" maxLength={500} defaultValue={currentLeaf?.sourceReference || ""}/></label>
        <label>Примітка<input name="note" maxLength={1000} defaultValue={currentLeaf?.note || ""}/></label>
        <div><button className="button primary" type="submit" disabled={saving}>{saving?"Зберігаємо…":"Додати ревізію"}</button></div>
      </form> : <p className="notice">Для створення нової ревізії потрібна роль адміністратора.</p>}
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Історія політики</b><small>Найновіші ревізії зверху. Future-effective revision не переписує попередню історію.</small></div></header>
      {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Чинність</th><th>Стан</th><th>Критерії</th><th>Джерело</th><th>Версія</th></tr></thead>
        <tbody>{revisions.map((revision)=><tr key={revision.id}>
          <td><b>{revision.effectiveFrom}</b><br/><small>{revision.createdAt}</small></td>
          <td><span className={`statusPill ${revision.enabled?"ok":""}`}>{revision.enabled?"Увімкнено":"Вимкнено"}</span><br/><small>{revision.requireClearanceValidUntil?"Строк допуску обов’язковий":"Строк допуску не є критерієм"}</small></td>
          <td><small>{criterion(revision.trainingMaxAgeDays,"Навчання")}<br/>{criterion(revision.knowledgeCheckMaxAgeDays,"Знання")}<br/>{criterion(revision.dosimetryMaxAgeDays,"Дозиметрія")}</small></td>
          <td>{revision.sourceTitle || "—"}{revision.sourceReference && <><br/><small>{revision.sourceReference}</small></>}{revision.note && <><br/><small>{revision.note}</small></>}</td>
          <td><span className={`statusPill ${revision.superseded?"":"ok"}`}>{revision.superseded?"Історична":"Leaf revision"}</span><br/><small>{revision.createdBy || "—"}</small></td>
        </tr>)}</tbody>
      </table>{!revisions.length && <p className="notice">Політика ще не налаштована. До створення першої ревізії жодних організаційних review-строків немає.</p>}</div>}
    </section>
  </StaffWorkspaceShell>;
}
