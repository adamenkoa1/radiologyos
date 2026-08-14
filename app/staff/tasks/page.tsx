"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Task = {
  id:number;title:string;details:string;status:"open"|"done";priority:"low"|"normal"|"high";
  dueDate:string;bookingId:number|null;assignedEmail:string;createdBy:string;completedBy:string;
  completedAt:string;createdAt:string;updatedAt:string;
};
type Member = { email:string;displayName:string;role:string };
type Staff = { email:string;displayName:string;role:string };

type Payload = { tasks:Task[];members:Member[];staff:Staff };
const priorityLabel:Record<Task["priority"],string> = { high:"Високий",normal:"Звичайний",low:"Низький" };

function todayKyiv() {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

export default function TasksPage() {
  const [data,setData] = useState<Payload|null>(null);
  const [error,setError] = useState("");
  const [loaded,setLoaded] = useState(false);
  const [mode,setMode] = useState<"open"|"done">("open");
  const [mine,setMine] = useState(false);
  const [busy,setBusy] = useState<number|null>(null);
  const [creating,setCreating] = useState(false);
  const [form,setForm] = useState({ title:"",details:"",priority:"normal",dueDate:"",assignedEmail:"" });

  async function load() {
    const res = await fetch("/api/staff/tasks",{cache:"no-store"});
    const payload = await res.json().catch(()=>({})) as Payload & {error?:string};
    if (!res.ok || !payload.staff) { setError(payload.error || "Не вдалося завантажити завдання"); setLoaded(true); return; }
    setData(payload); setError(""); setLoaded(true);
  }
  useEffect(()=>{ const t=window.setTimeout(()=>void load(),0); return()=>window.clearTimeout(t); },[]);

  const nameByEmail = useMemo(()=>Object.fromEntries((data?.members||[]).map(m=>[m.email,m.displayName||m.email])),[data]);
  const tasks = useMemo(()=>{
    let list=(data?.tasks||[]).filter(t=>t.status===mode);
    if(mine) list=list.filter(t=>t.assignedEmail===data?.staff.email);
    return list;
  },[data,mode,mine]);
  const today=todayKyiv();
  const overdue=(t:Task)=>t.status==="open" && !!t.dueDate && t.dueDate<today;

  async function createTask() {
    if(!form.title.trim()) return;
    const res=await fetch("/api/staff/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});
    const payload=await res.json().catch(()=>({})) as {error?:string};
    if(!res.ok){setError(payload.error||"Не вдалося створити завдання");return;}
    setCreating(false);setForm({title:"",details:"",priority:"normal",dueDate:"",assignedEmail:""});await load();
  }

  async function patchTask(id:number,body:Record<string,unknown>) {
    setBusy(id);
    try {
      const res=await fetch("/api/staff/tasks",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,...body})});
      const payload=await res.json().catch(()=>({})) as {error?:string};
      if(!res.ok){setError(payload.error||"Не вдалося змінити завдання");return;}
      await load();
    } finally {setBusy(null);}
  }

  return <StaffWorkspaceShell active="tasks" title="Завдання" description="Особисті й командні задачі відділення: відповідальний, термін, пріоритет і контроль виконання." staffName={data?.staff.displayName||data?.staff.email} staffRole={data?.staff.role}>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loaded ? <p className="dashLoading">Завантаження завдань…</p> : !data ? null : <section className="taskWorkspace">
      <div className="taskToolbar">
        <div className="taskSegments">
          <button className={mode==="open"?"on":""} onClick={()=>setMode("open")}>В роботі</button>
          <button className={mode==="done"?"on":""} onClick={()=>setMode("done")}>Виконані</button>
        </div>
        <label className="taskMine"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/> Тільки мої</label>
        <button className="taskNew" onClick={()=>setCreating(v=>!v)}>{creating?"Закрити":"+ Нове завдання"}</button>
      </div>

      {creating && <div className="taskCreate">
        <label><span>Назва</span><input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} maxLength={180} placeholder="Що потрібно зробити"/></label>
        <label><span>Деталі</span><textarea value={form.details} onChange={e=>setForm(f=>({...f,details:e.target.value}))} rows={3} placeholder="Контекст, результат, примітки"/></label>
        <div className="taskCreateRow">
          <label><span>Пріоритет</span><select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}><option value="high">Високий</option><option value="normal">Звичайний</option><option value="low">Низький</option></select></label>
          <label><span>До дати</span><input type="date" value={form.dueDate} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))}/></label>
          <label><span>Виконавець</span><select value={form.assignedEmail} onChange={e=>setForm(f=>({...f,assignedEmail:e.target.value}))}><option value="">Без виконавця</option>{data.members.map(m=><option key={m.email} value={m.email}>{m.displayName||m.email}</option>)}</select></label>
        </div>
        <button className="taskSave" disabled={!form.title.trim()} onClick={()=>void createTask()}>Створити завдання</button>
      </div>}

      <div className="taskSummary">
        <span><b>{(data.tasks||[]).filter(t=>t.status==="open").length}</b>В роботі</span>
        <span className="warn"><b>{(data.tasks||[]).filter(overdue).length}</b>Прострочено</span>
        <span><b>{(data.tasks||[]).filter(t=>t.status==="open"&&t.assignedEmail===data.staff.email).length}</b>Мої</span>
      </div>

      <div className="taskList">
        {tasks.length===0 ? <p className="taskEmpty">Завдань у цьому списку немає.</p> : tasks.map(t=><article className={`taskCard priority-${t.priority}${overdue(t)?" overdue":""}`} key={t.id}>
          <div className="taskCardMain">
            <div className="taskCardTop"><span className={`taskPriority ${t.priority}`}>{priorityLabel[t.priority]}</span>{overdue(t)&&<span className="taskOverdue">Прострочено</span>}</div>
            <h2>{t.title}</h2>
            {t.details&&<p>{t.details}</p>}
            <div className="taskMeta">
              {t.assignedEmail?<span>Виконавець: <b>{nameByEmail[t.assignedEmail]||t.assignedEmail}</b></span>:<span>Без виконавця</span>}
              {t.dueDate&&<span>До: <b>{t.dueDate}</b></span>}
              {t.bookingId&&<a href={`/staff/protocols?open=${t.bookingId}`}>Дослідження #{t.bookingId}</a>}
            </div>
          </div>
          <div className="taskActions">
            {t.status==="open"?<button disabled={busy===t.id} onClick={()=>void patchTask(t.id,{status:"done"})}>{busy===t.id?"…":"✓ Виконано"}</button>:<button disabled={busy===t.id} onClick={()=>void patchTask(t.id,{status:"open"})}>Повернути в роботу</button>}
          </div>
        </article>)}
      </div>
    </section>}
  </StaffWorkspaceShell>;
}
