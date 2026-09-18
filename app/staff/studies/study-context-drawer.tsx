"use client";

import { useCallback,useEffect,useState } from "react";
import styles from "./study-context.module.css";

type StudyRef={id:number;code:string;name:string;service:string;stateLabel:string};
type ContextData={
  booking?:{id:number;code:string;name:string;service:string;status:string;comment:string;createdAt:string};
  note?:{note:string;updatedBy:string;updatedAt:string}|null;
  comments?:Array<{id:number;body:string;authorEmail:string;authorName:string;createdAt:string}>;
  events?:Array<{id:number;action:string;details:string;actor:string;createdAt:string}>;
  canComment?:boolean;error?:string;
};
type CustomField={id:number;label:string;fieldType:string;options:string[];required:number;value:string};
type CustomFieldData={definitions?:CustomField[];canWrite?:boolean;canManage?:boolean;error?:string};

const EVENT_LABELS:Record<string,string>={
  created:"Заявку створено",created_by_staff:"Створено персоналом",rescheduled:"Перенесено",
  staff_note:"Оновлено службову нотатку",status_changed:"Змінено стан",protocol_updated:"Оновлено протокол",
  finance_updated:"Оновлено оплату / НСЗУ",staff_assigned:"Призначено виконавців",execution_recorded:"Зафіксовано виконання",
  protocol_document_saved:"Збережено протокол",ai_draft_generated:"Сформовано AI-чернетку",comment_added:"Додано коментар",
  custom_field_updated:"Оновлено додатковий реквізит",
};

function when(value:string){
  if(!value)return "";
  const d=new Date(value.includes("T")?value:`${value.replace(" ","T")}Z`);
  if(Number.isNaN(d.getTime()))return value;
  return new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);
}

export default function StudyContextDrawer({study,onClose}:{study:StudyRef;onClose:()=>void}){
  const [data,setData]=useState<ContextData|null>(null);
  const [custom,setCustom]=useState<CustomFieldData|null>(null);
  const [values,setValues]=useState<Record<number,string>>({});
  const [text,setText]=useState("");
  const [busy,setBusy]=useState(false);
  const [fieldBusy,setFieldBusy]=useState<number|null>(null);
  const [error,setError]=useState("");
  const [fieldError,setFieldError]=useState("");

  const load=useCallback(async()=>{
    const response=await fetch(`/api/staff/study-context?id=${study.id}`,{cache:"no-store"});
    const payload=await response.json().catch(()=>({})) as ContextData;
    if(!response.ok){setError(payload.error||"Не вдалося завантажити історію");return;}
    setData(payload);setError("");
  },[study.id]);

  const loadCustom=useCallback(async()=>{
    const response=await fetch(`/api/staff/custom-fields?bookingId=${study.id}`,{cache:"no-store"});
    const payload=await response.json().catch(()=>({})) as CustomFieldData;
    if(!response.ok){setFieldError(payload.error||"Не вдалося завантажити додаткові реквізити");return;}
    setCustom(payload);
    setValues(Object.fromEntries((payload.definitions||[]).map(field=>[field.id,field.value||""])));
    setFieldError("");
  },[study.id]);

  useEffect(()=>{const timer=window.setTimeout(()=>{void load();void loadCustom();},0);return()=>window.clearTimeout(timer);},[load,loadCustom]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[onClose]);

  async function submit(){
    const value=text.trim();if(!value)return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/staff/study-context",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:study.id,text:value})});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setError(payload.error||"Не вдалося додати коментар");return;}
      setText("");await load();
    }catch{setError("Помилка мережі — коментар не збережено");}
    finally{setBusy(false);}
  }

  async function saveField(field:CustomField){
    setFieldBusy(field.id);setFieldError("");
    try{
      let value:unknown=values[field.id]??"";
      if(field.fieldType==="boolean" && value!=="")value=value==="1";
      const response=await fetch("/api/staff/custom-fields",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({bookingId:study.id,fieldId:field.id,value})});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setFieldError(payload.error||"Не вдалося зберегти реквізит");return;}
      await Promise.all([loadCustom(),load()]);
    }catch{setFieldError("Помилка мережі — реквізит не збережено");}
    finally{setFieldBusy(null);}
  }

  function control(field:CustomField){
    const value=values[field.id]??"";
    const common={value,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>setValues(prev=>({...prev,[field.id]:e.target.value}))};
    if(field.fieldType==="boolean")return <select {...common}><option value="">—</option><option value="1">Так</option><option value="0">Ні</option></select>;
    if(field.fieldType==="select")return <select {...common}><option value="">—</option>{field.options.map(option=><option key={option} value={option}>{option}</option>)}</select>;
    return <input {...common} type={field.fieldType==="date"?"date":field.fieldType==="number"?"number":"text"} maxLength={field.fieldType==="text"?500:undefined} step={field.fieldType==="number"?"any":undefined}/>;
  }

  return <div className={styles.backdrop} role="presentation" onMouseDown={(e)=>{if(e.currentTarget===e.target)onClose();}}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Історія ${study.code}`}>
      <header className={styles.head}>
        <div><h2>Історія дослідження</h2><p>{study.code} · {study.name||"Пацієнт"} · {study.service}</p></div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Закрити">✕</button>
      </header>

      {error?<section className={styles.section}><p className={styles.error}>{error}</p></section>:null}
      {!data&&!error?<section className={styles.section}><span className={styles.empty}>Завантаження…</span></section>:null}

      {data?<>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h3>Додаткові реквізити</h3>{custom?.canManage?<a href="/staff/custom-fields">Налаштувати поля</a>:null}</div>
          {fieldError?<p className={styles.error}>{fieldError}</p>:null}
          {custom?.definitions?.length?<div className={styles.fields}>{custom.definitions.map(field=><label className={styles.field} key={field.id}>
            <span>{field.label}{field.required?<b> *</b>:null}</span>
            <div>{control(field)}{custom.canWrite?<button type="button" disabled={fieldBusy===field.id} onClick={()=>void saveField(field)}>{fieldBusy===field.id?"…":"Зберегти"}</button>:null}</div>
          </label>)}</div>:<span className={styles.empty}>{custom?.canManage?"Додаткові поля ще не створені.":"Додаткових реквізитів немає."}</span>}
        </section>

        <section className={styles.section}>
          <h3>Службова нотатка</h3>
          {data.note?.note?<div className={styles.note}>{data.note.note}<span className={styles.meta}>{data.note.updatedBy||"—"} · {when(data.note.updatedAt)}</span></div>:<span className={styles.empty}>Службової нотатки немає.</span>}
        </section>

        {data.canComment?<section className={styles.section}>
          <h3>Новий коментар</h3>
          <div className={styles.form}>
            <textarea value={text} maxLength={2000} onChange={(e)=>setText(e.target.value)} placeholder="Уточнення, домовленість, клінічний або організаційний коментар…" aria-label="Новий внутрішній коментар"/>
            <button type="button" disabled={busy||!text.trim()} onClick={()=>void submit()}>{busy?"Збереження…":"Додати коментар"}</button>
          </div>
        </section>:null}

        <section className={styles.section}>
          <h3>Коментарі <span className={styles.badge}>{data.comments?.length||0}</span></h3>
          <div className={styles.timeline}>{data.comments?.length?data.comments.map(c=><article className={styles.item} key={c.id}><b>{c.authorName||c.authorEmail}</b><p>{c.body}</p><span className={styles.meta}>{when(c.createdAt)}</span></article>):<span className={styles.empty}>Коментарів ще немає.</span>}</div>
        </section>

        <section className={styles.section}>
          <h3>Події workflow <span className={styles.badge}>{data.events?.length||0}</span></h3>
          <div className={styles.timeline}>{data.events?.length?data.events.map(e=><article className={styles.item} key={e.id}><b>{EVENT_LABELS[e.action]||e.action}</b>{e.details?<p>{e.details}</p>:null}<span className={styles.meta}>{e.actor||"система"} · {when(e.createdAt)}</span></article>):<span className={styles.empty}>Подій немає.</span>}</div>
        </section>
      </>:null}
    </aside>
  </div>;
}
