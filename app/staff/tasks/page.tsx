"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Task = {
  id:number;title:string;details:string;status:"open"|"done";priority:"low"|"normal"|"high";
  dueDate:string;bookingId:number|null;assignedEmail:string;createdBy:string;completedBy:string;
  completedAt:string;createdAt:string;updatedAt:string;source:"manual"|"automation";
  automationKey:string;sourceEntityType:string;sourceEntityId:string;
};
type Member = { email:string;displayName:string;role:string };
type Staff = { email:string;displayName:string;role:string };
type Payload = { tasks:Task[];members:Member[];staff:Staff };
const priorityLabel:Record<Task["priority"],string> = { high:"Високий",normal:"Звичайний",low:"Низький" };
const MODES:{ id:"open"|"done"; label:string }[] = [{ id:"open",label:"В роботі" },{ id:"done",label:"Виконані" }];

function todayKyiv() {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function sourceHref(task:Task) {
  if(task.sourceEntityType==="booking_followup"&&task.bookingId) return `/staff?open=${task.bookingId}#bookings`;
  if(task.sourceEntityType==="inventory_item") return "/staff/inventory";
  if(task.sourceEntityType==="equipment_maintenance") return "/staff/maintenance";
  return "";
}
function sourceLabel(task:Task) {
  if(task.sourceEntityType==="booking_followup") return "Відкрити запис";
  if(task.sourceEntityType==="inventory_item") return "Відкрити склад";
  if(task.sourceEntityType==="equipment_maintenance") return "Відкрити ТО";
  return "";
}

export default function TasksPage() {
  const [data,setData] = useState<Payload|null>(null);
  const [error,setError] = useState("");
  const [loaded,setLoaded] = useState(false);
  // Мережевий збій завантаження — щоб показати «Повторити», а не вічний спінер.
  const [loadError,setLoadError] = useState(false);
  const [mode,setMode] = useState<"open"|"done">("open");
  const [mine,setMine] = useState(false);
  const [busy,setBusy] = useState<number|null>(null);
  const [creating,setCreating] = useState(false);
  const [followUpMode,setFollowUpMode] = useState(false);
  const [submitting,setSubmitting] = useState(false);
  const [form,setForm] = useState<{title:string;details:string;priority:string;dueDate:string;assignedEmail:string;bookingId:number|null}>({ title:"",details:"",priority:"normal",dueDate:"",assignedEmail:"",bookingId:null });

  // background:true — тихе автооновлення: не блимає спінером і не глушить список
  // через тимчасовий збій (лишає наявні завдання до наступної спроби).
  async function load({ background = false } = {}) {
    try {
      const res = await fetch("/api/staff/tasks",{cache:"no-store"});
      const payload = await res.json().catch(()=>({})) as Payload & {error?:string};
      if (!res.ok || !payload.staff) { if(!background){ setError(payload.error || "Не вдалося завантажити завдання"); setLoaded(true);} return; }
      setData(payload); setError(""); setLoadError(false); setLoaded(true);
    } catch {
      // Мережевий збій першого завантаження — показуємо «Повторити».
      if(!background){ setLoadError(true); setLoaded(true); }
    }
  }
  useEffect(()=>{ const t=window.setTimeout(()=>void load(),0); return()=>window.clearTimeout(t); },[]);

  // Patient-card shortcut: open a booking-linked follow-up task without copying patient PII into the task.
  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      const params=new URLSearchParams(window.location.search);
      if(params.get("followUp")!=="1") return;
      const bookingId=Number(params.get("bookingId"));
      if(!Number.isInteger(bookingId)||bookingId<1) return;
      setForm({title:"Повторно зв’язатися щодо запису",details:"",priority:"normal",dueDate:todayKyiv(),assignedEmail:"",bookingId});
      setFollowUpMode(true);
      setCreating(true);
    },0);
    return()=>window.clearTimeout(timer);
  },[]);

  // Не оновлюємо у фоні під час мутації чи створення завдання.
  const pauseRef = useRef(false);
  useEffect(()=>{ pauseRef.current = busy!==null || creating || submitting; });

  // Живий список: тихо оновлюємо завдання кожні 45 с, тож нові автоматичні й
  // командні задачі зʼявляються без ручного перезавантаження.
  useEffect(()=>{
    const id=window.setInterval(()=>{ if(document.hidden||pauseRef.current) return; void load({background:true}); },45000);
    return()=>window.clearInterval(id);
  },[]);

  const nameByEmail = useMemo(()=>Object.fromEntries((data?.members||[]).map(m=>[m.email,m.displayName||m.email])),[data]);
  const tasks = useMemo(()=>{
    let list=(data?.tasks||[]).filter(t=>t.status===mode);
    if(mine) list=list.filter(t=>t.assignedEmail===data?.staff.email);
    return list;
  },[data,mode,mine]);
  const today=todayKyiv();
  const overdue=(t:Task)=>t.status==="open" && !!t.dueDate && t.dueDate<today;

  // Повна WAI-ARIA таб-навігація фільтра станів (як на /staff/finance):
  // стрілки/Home/End перемикають вкладку й переносять фокус.
  function onTabKeyDown(event:ReactKeyboardEvent<HTMLButtonElement>){
    const idx=MODES.findIndex(m=>m.id===mode);let next=idx;
    if(event.key==="ArrowRight"||event.key==="ArrowDown")next=(idx+1)%MODES.length;
    else if(event.key==="ArrowLeft"||event.key==="ArrowUp")next=(idx-1+MODES.length)%MODES.length;
    else if(event.key==="Home")next=0;
    else if(event.key==="End")next=MODES.length-1;
    else return;
    event.preventDefault();setMode(MODES[next].id);
    document.getElementById(`task-tab-${MODES[next].id}`)?.focus();
  }

  async function createTask() {
    if(!form.title.trim()||submitting) return;
    const assignedEmail=form.assignedEmail||(followUpMode?data?.staff.email||"": "");
    if(followUpMode&&(!form.bookingId||!form.dueDate||!assignedEmail)){
      setError("Для follow-up задачі вкажіть строк і відповідального.");
      return;
    }
    setSubmitting(true);
    try {
      const res=await fetch("/api/staff/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,assignedEmail,sourceEntityType:followUpMode?"booking_followup":""})});
      const payload=await res.json().catch(()=>({})) as {error?:string};
      if(!res.ok){setError(payload.error||"Не вдалося створити завдання");return;}
      setCreating(false);setFollowUpMode(false);setForm({title:"",details:"",priority:"normal",dueDate:"",assignedEmail:"",bookingId:null});await load();
    } catch {
      // Мережевий збій створення — показуємо помилку, а не мовчазний no-op.
      setError("Не вдалося створити завдання. Перевірте зʼєднання та спробуйте ще раз.");
    } finally {setSubmitting(false);}
  }

  async function patchTask(id:number,body:Record<string,unknown>) {
    setBusy(id);
    try {
      const res=await fetch("/api/staff/tasks",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,...body})});
      const payload=await res.json().catch(()=>({})) as {error?:string};
      if(!res.ok){setError(payload.error||"Не вдалося змінити завдання");return;}
      await load();
    } catch {
      // Мережевий збій: без catch throw ковтався `void patchTask(...)` і дія
      // («Виконано»/«Повернути в роботу») була мовчазним no-op без помилки.
      setError("Не вдалося змінити завдання. Перевірте зʼєднання та спробуйте ще раз.");
    } finally {setBusy(null);}
  }

  return <StaffWorkspaceShell active="tasks" title="Завдання" description="Особисті, командні й автоматичні задачі відділення: відповідальний, термін, пріоритет і контроль виконання." staffName={data?.staff.displayName||data?.staff.email} staffRole={data?.staff.role}>
    {error && <p className="notice error" role="alert">{error}</p>}
    {loadError && !data ? <section className="accessDenied"><b>Не вдалося завантажити</b><p>Не вдалося завантажити завдання. Перевірте зʼєднання та спробуйте ще раз.</p><button type="button" className="button compact" onClick={()=>{ setLoadError(false); setLoaded(false); void load(); }}>Повторити</button></section>
      : !loaded ? <p className="dashLoading" role="status" aria-live="polite">Завантаження завдань…</p> : !data ? null : <section className="taskWorkspace">
      <div className="taskToolbar">
        <div className="taskSegments" role="tablist" aria-label="Фільтр завдань за станом">
          <button type="button" role="tab" id="task-tab-open" aria-selected={mode==="open"} aria-controls="task-panel" tabIndex={mode==="open"?0:-1} className={mode==="open"?"on":""} onClick={()=>setMode("open")} onKeyDown={onTabKeyDown}>В роботі</button>
          <button type="button" role="tab" id="task-tab-done" aria-selected={mode==="done"} aria-controls="task-panel" tabIndex={mode==="done"?0:-1} className={mode==="done"?"on":""} onClick={()=>setMode("done")} onKeyDown={onTabKeyDown}>Виконані</button>
        </div>
        <label className="taskMine"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/> Тільки мої</label>
        <button className="taskNew" onClick={()=>setCreating(v=>!v)}>{creating?"Закрити":"+ Нове завдання"}</button>
      </div>

      {creating && <div className="taskCreate">
        <label><span>Назва</span><input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} maxLength={180} placeholder="Що потрібно зробити"/></label>
        <label><span>Деталі</span><textarea value={form.details} onChange={e=>setForm(f=>({...f,details:e.target.value}))} rows={3} placeholder="Контекст, результат, примітки"/></label>
        {form.bookingId&&<p>Пов’язано із записом #{form.bookingId}. Дані пацієнта в завданні не дублюються.</p>}
        {followUpMode&&<p role="note">Для follow-up потрібні відповідальний і строк. Початково обрані ви та сьогодні; за потреби змініть їх.</p>}
        <div className="taskCreateRow">
          <label><span>Пріоритет</span><select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}><option value="high">Високий</option><option value="normal">Звичайний</option><option value="low">Низький</option></select></label>
          <label><span>До дати{followUpMode?" *":""}</span><input type="date" required={followUpMode} value={form.dueDate} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))}/></label>
          <label><span>Виконавець{followUpMode?" *":""}</span><select required={followUpMode} value={form.assignedEmail||(followUpMode?data.staff.email:"")} onChange={e=>setForm(f=>({...f,assignedEmail:e.target.value}))}>{!followUpMode&&<option value="">Без виконавця</option>}{data.members.map(m=><option key={m.email} value={m.email}>{m.displayName||m.email}</option>)}</select></label>
        </div>
        <button className="taskSave" disabled={!form.title.trim()||submitting} onClick={()=>void createTask()}>{submitting?"Створення…":"Створити завдання"}</button>
      </div>}

      <div className="taskSummary">
        <span><b>{(data.tasks||[]).filter(t=>t.status==="open").length}</b>В роботі</span>
        <span className="warn"><b>{(data.tasks||[]).filter(overdue).length}</b>Прострочено</span>
        <span><b>{(data.tasks||[]).filter(t=>t.status==="open"&&t.assignedEmail===data.staff.email).length}</b>Мої</span>
      </div>

      <div className="taskList" role="tabpanel" id="task-panel" aria-labelledby={`task-tab-${mode}`} tabIndex={0}>
        {tasks.length===0 ? <p className="taskEmpty">Завдань у цьому списку немає.</p> : tasks.map(t=><article className={`taskCard priority-${t.priority}${overdue(t)?" overdue":""}`} key={t.id}>
          <div className="taskCardMain">
            <div className="taskCardTop">
              <span className={`taskPriority ${t.priority}`}>{priorityLabel[t.priority]}</span>
              {t.source==="automation"&&<span className="taskAuto">Автоматично</span>}
              {overdue(t)&&<span className="taskOverdue">Прострочено</span>}
            </div>
            <h2>{t.title}</h2>
            {t.details&&<p>{t.details}</p>}
            <div className="taskMeta">
              {t.assignedEmail?<span>Виконавець: <b>{nameByEmail[t.assignedEmail]||t.assignedEmail}</b></span>:<span>Без виконавця</span>}
              {t.dueDate&&<span>До: <b>{t.dueDate}</b></span>}
              {t.bookingId&&<a href={`/staff/protocols?open=${t.bookingId}`}>Дослідження #{t.bookingId}</a>}
              {sourceHref(t)&&<a href={sourceHref(t)}>{sourceLabel(t)}</a>}
            </div>
          </div>
          <div className="taskActions">
            {t.status==="open"?<button disabled={busy===t.id} onClick={()=>void patchTask(t.id,{status:"done"})}>{busy===t.id?"…":"✓ Виконано"}</button>:t.source==="automation"?<span className="taskAutoDone">Керується системою</span>:<button disabled={busy===t.id} onClick={()=>void patchTask(t.id,{status:"open"})}>Повернути в роботу</button>}
          </div>
        </article>)}
      </div>
    </section>}
  </StaffWorkspaceShell>;
}
