"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Warehouse={id:number;code:string;name:string;active:number;isDefault:number;createdAt:string;updatedAt:string};
type Staff={email:string;displayName:string;role:string};
type Payload={warehouses:Warehouse[];staff:Staff;canEdit:boolean;error?:string};
type Form={id:number|null;code:string;name:string;active:boolean;isDefault:boolean};
const EMPTY:Form={id:null,code:"",name:"",active:true,isDefault:false};

export default function WarehousesPage(){
  const [data,setData]=useState<Payload|null>(null);const [form,setForm]=useState<Form>(EMPTY);const [query,setQuery]=useState("");const [error,setError]=useState("");const [notice,setNotice]=useState("");const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{const response=await fetch("/api/staff/warehouses",{cache:"no-store"});const payload=await response.json().catch(()=>({})) as Payload;if(!response.ok)throw new Error(payload.error||"Не вдалося завантажити склади");setData(payload);setError("");},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load().catch(e=>setError(e instanceof Error?e.message:"Помилка")),0);return()=>window.clearTimeout(timer);},[load]);
  const rows=useMemo(()=>{const q=query.trim().toLowerCase();return(data?.warehouses||[]).filter(row=>!q||`${row.name} ${row.code}`.toLowerCase().includes(q));},[data,query]);
  function edit(row:Warehouse){setForm({id:row.id,code:row.code,name:row.name,active:!!row.active,isDefault:!!row.isDefault});setNotice("");}
  function reset(){setForm(EMPTY);setNotice("");}
  async function save(event:React.FormEvent){event.preventDefault();if(!data?.canEdit)return;setBusy(true);setNotice("");try{const response=await fetch("/api/staff/warehouses",{method:form.id?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const payload=await response.json().catch(()=>({})) as {error?:string;warehouse?:Warehouse};if(!response.ok){setNotice(`⚠ ${payload.error||"Не вдалося зберегти"}`);return;}setNotice(`✓ ${form.id?"Склад оновлено":"Склад створено"}`);await load();if(payload.warehouse)edit(payload.warehouse);}finally{setBusy(false);}}
  return <StaffWorkspaceShell active="inventory" title="Склади" description="BAS-довідник місць зберігання. Залишки й складські документи ведуться по конкретному складу." staffName={data?.staff.displayName||data?.staff.email} staffRole={data?.staff.role}>
    {error&&<p className="financeError">{error}</p>}{!data&&!error&&<p className="financeLoading">Завантаження…</p>}
    {data&&<div className="inventoryDocumentsLayout"><section className="financeJournal"><header className="financeToolbar"><div className="financeTabs"><button type="button" onClick={()=>window.location.assign("/staff/inventory")}>← Складський облік</button></div><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук: назва або код…"/><button type="button" onClick={()=>void load()}>Оновити</button></header><div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Склад</th><th>Код</th><th>Основний</th><th>Стан</th><th/></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><b>{row.name}</b><small>ID {row.id}</small></td><td>{row.code||"—"}</td><td>{row.isDefault?<b>Так</b>:"—"}</td><td><span className={`financeState ${row.active?"state-posted":"state-cancelled"}`}>{row.active?"Активний":"Неактивний"}</span></td><td><button type="button" onClick={()=>edit(row)}>Відкрити</button></td></tr>)}{rows.length===0&&<tr><td colSpan={5}>Складів за відбором немає.</td></tr>}</tbody></table></div></section>
      <section className="inventoryDocumentCard"><header><div><small>Довідник</small><h2>{form.id?`Склад #${form.id}`:"Новий склад"}</h2><p>{data.canEdit?"Назву й код можна змінити; проведені документи зберігають власний історичний snapshot.":"Режим перегляду; змінює лише адміністратор."}</p></div></header>{notice&&<p className={notice.startsWith("⚠")?"financeError":"notice"}>{notice}</p>}
        <form className="inventoryOperations" onSubmit={save}><div><label>Назва<input required disabled={!data.canEdit} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Код<input disabled={!data.canEdit} value={form.code} onChange={e=>setForm({...form,code:e.target.value})}/></label><label><input type="checkbox" disabled={!data.canEdit} checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Активний</label><label><input type="checkbox" disabled={!data.canEdit} checked={form.isDefault} onChange={e=>setForm({...form,isDefault:e.target.checked,active:e.target.checked?true:form.active})}/> Основний склад</label>{data.canEdit&&<div><button className="primary" disabled={busy}>{form.id?"Записати":"Створити"}</button><button type="button" disabled={busy} onClick={reset}>Новий</button></div>}</div></form>
      </section></div>}
  </StaffWorkspaceShell>;
}
