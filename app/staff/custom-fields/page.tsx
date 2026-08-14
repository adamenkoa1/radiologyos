"use client";

import { FormEvent,useCallback,useEffect,useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import styles from "./custom-fields.module.css";

type Definition={id:number;label:string;fieldType:string;options:string[];required:number;active:number;sortOrder:number};
type Draft={label:string;optionsText:string;required:boolean;active:boolean;sortOrder:number};
const TYPE_LABELS:Record<string,string>={text:"Текст",number:"Число",date:"Дата",boolean:"Так / Ні",select:"Список"};

function optionList(text:string){return text.split(/[\n,;]/).map(v=>v.trim()).filter(Boolean).slice(0,20);}

export default function CustomFieldsPage(){
  const [definitions,setDefinitions]=useState<Definition[]>([]);
  const [drafts,setDrafts]=useState<Record<number,Draft>>({});
  const [forbidden,setForbidden]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<number|"new"|null>(null);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const [label,setLabel]=useState("");
  const [fieldType,setFieldType]=useState("text");
  const [optionsText,setOptionsText]=useState("");
  const [required,setRequired]=useState(false);
  const [sortOrder,setSortOrder]=useState(0);

  const load=useCallback(async()=>{
    setLoading(true);
    const response=await fetch("/api/staff/custom-fields",{cache:"no-store"});
    if(response.status===403){setForbidden(true);setLoading(false);return;}
    const payload=await response.json().catch(()=>({})) as {definitions?:Definition[];error?:string};
    if(!response.ok){setError(payload.error||"Не вдалося завантажити поля");setLoading(false);return;}
    const rows=payload.definitions||[];
    setDefinitions(rows);
    setDrafts(Object.fromEntries(rows.map(row=>[row.id,{label:row.label,optionsText:row.options.join("\n"),required:Boolean(row.required),active:Boolean(row.active),sortOrder:row.sortOrder}]));
    setError("");setLoading(false);
  },[]);

  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);},[load]);

  async function create(event:FormEvent){
    event.preventDefault();setBusy("new");setError("");setNotice("");
    try{
      const response=await fetch("/api/staff/custom-fields",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({label,fieldType,options:optionList(optionsText),required,sortOrder})});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setError(payload.error||"Не вдалося створити поле");return;}
      setLabel("");setOptionsText("");setRequired(false);setSortOrder(0);setFieldType("text");setNotice("Поле створено");await load();
    }catch{setError("Помилка мережі");}finally{setBusy(null);}
  }

  async function save(definition:Definition){
    const draft=drafts[definition.id];if(!draft)return;
    setBusy(definition.id);setError("");setNotice("");
    try{
      const response=await fetch("/api/staff/custom-fields",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:definition.id,label:draft.label,options:optionList(draft.optionsText),required:draft.required,active:draft.active,sortOrder:draft.sortOrder})});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setError(payload.error||"Не вдалося оновити поле");return;}
      setNotice("Зміни збережено");await load();
    }catch{setError("Помилка мережі");}finally{setBusy(null);}
  }

  const body=forbidden?<div className="accessDenied"><b>Доступ обмежено</b><p>Додаткові реквізити налаштовує лише адміністратор.</p></div>:
    <div className={styles.layout}>
      <form className={styles.create} onSubmit={create}>
        <div><h2>Нове поле дослідження</h2><p>Поле з’явиться у картці «Історія дослідження» для всіх працівників, які мають доступ до цього дослідження.</p></div>
        <label><span>Назва</span><input value={label} onChange={e=>setLabel(e.target.value)} maxLength={120} required placeholder="Напр., Тип направлення"/></label>
        <label><span>Тип</span><select value={fieldType} onChange={e=>setFieldType(e.target.value)}>{Object.entries(TYPE_LABELS).map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>
        {fieldType==="select"?<label><span>Варіанти списку</span><textarea value={optionsText} onChange={e=>setOptionsText(e.target.value)} placeholder={"Один варіант на рядок\nабо через кому"}/></label>:null}
        <div className={styles.row}><label className={styles.check}><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/><span>Обов’язкове</span></label><label><span>Порядок</span><input type="number" min={-1000} max={1000} value={sortOrder} onChange={e=>setSortOrder(Number(e.target.value)||0)}/></label></div>
        <button type="submit" disabled={busy==="new"||!label.trim()}>{busy==="new"?"Створення…":"Створити поле"}</button>
      </form>

      <section className={styles.list}>
        <div className={styles.listHead}><div><h2>Поля дослідження</h2><p>Тип поля після створення не змінюється — це захищає вже внесені значення.</p></div><a href="/staff/studies">До досліджень</a></div>
        {error?<p className={styles.error}>{error}</p>:null}{notice?<p className={styles.notice}>{notice}</p>:null}
        {loading?<p className={styles.empty}>Завантаження…</p>:definitions.length===0?<p className={styles.empty}>Поля ще не створені.</p>:definitions.map(definition=>{
          const draft=drafts[definition.id];if(!draft)return null;
          return <article className={styles.card} key={definition.id}>
            <div className={styles.cardHead}><span className={styles.type}>{TYPE_LABELS[definition.fieldType]||definition.fieldType}</span><span className={draft.active?styles.on:styles.off}>{draft.active?"Активне":"Вимкнене"}</span></div>
            <label><span>Назва</span><input value={draft.label} maxLength={120} onChange={e=>setDrafts(prev=>({...prev,[definition.id]:{...draft,label:e.target.value}}))}/></label>
            {definition.fieldType==="select"?<label><span>Варіанти</span><textarea value={draft.optionsText} onChange={e=>setDrafts(prev=>({...prev,[definition.id]:{...draft,optionsText:e.target.value}}))}/></label>:null}
            <div className={styles.row}><label className={styles.check}><input type="checkbox" checked={draft.required} onChange={e=>setDrafts(prev=>({...prev,[definition.id]:{...draft,required:e.target.checked}}))}/><span>Обов’язкове</span></label><label className={styles.check}><input type="checkbox" checked={draft.active} onChange={e=>setDrafts(prev=>({...prev,[definition.id]:{...draft,active:e.target.checked}}))}/><span>Активне</span></label><label><span>Порядок</span><input type="number" min={-1000} max={1000} value={draft.sortOrder} onChange={e=>setDrafts(prev=>({...prev,[definition.id]:{...draft,sortOrder:Number(e.target.value)||0}}))}/></label></div>
            <button type="button" disabled={busy===definition.id||!draft.label.trim()} onClick={()=>void save(definition)}>{busy===definition.id?"Збереження…":"Зберегти"}</button>
          </article>;
        })}
      </section>
    </div>;

  return <StaffWorkspaceShell active="settings" title="Додаткові реквізити" description="Власні поля для картки дослідження без зміни основної медичної схеми.">{body}</StaffWorkspaceShell>;
}
