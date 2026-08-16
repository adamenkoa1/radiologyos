"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Kind="supplier"|"payer"|"both"|"other";
type Counterparty={id:number;code:string;name:string;kind:Kind;taxId:string;phone:string;email:string;address:string;active:number;createdAt:string;updatedAt:string};
type Staff={email:string;displayName:string;role:string};
type Payload={counterparties:Counterparty[];staff:Staff;canManage:boolean;error?:string};
type Form={id:number|null;code:string;name:string;kind:Kind;taxId:string;phone:string;email:string;address:string;active:boolean};

const EMPTY:Form={id:null,code:"",name:"",kind:"supplier",taxId:"",phone:"",email:"",address:"",active:true};
const KIND_UK:Record<Kind,string>={supplier:"Постачальник",payer:"Платник",both:"Постачальник і платник",other:"Інший"};

export default function CounterpartiesPage(){
  const [data,setData]=useState<Payload|null>(null);
  const [form,setForm]=useState<Form>(EMPTY);
  const [query,setQuery]=useState("");
  const [kind,setKind]=useState<"all"|Kind>("all");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);

  const load=useCallback(async()=>{
    const response=await fetch("/api/staff/counterparties",{cache:"no-store"});
    const payload=await response.json().catch(()=>({})) as Payload;
    if(!response.ok)throw new Error(payload.error||"Не вдалося завантажити контрагентів");
    setData(payload);setError("");
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load().catch(e=>setError(e instanceof Error?e.message:"Помилка")),0);return()=>window.clearTimeout(timer);},[load]);

  const rows=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return (data?.counterparties||[]).filter(row=>(kind==="all"||row.kind===kind||kind==="supplier"&&row.kind==="both")&&(!q||`${row.name} ${row.code} ${row.taxId}`.toLowerCase().includes(q)));
  },[data,query,kind]);

  function edit(row:Counterparty){setForm({id:row.id,code:row.code,name:row.name,kind:row.kind,taxId:row.taxId,phone:row.phone,email:row.email,address:row.address,active:!!row.active});setNotice("");}
  function reset(){setForm(EMPTY);setNotice("");}

  async function save(event:React.FormEvent){
    event.preventDefault();if(!data?.canManage)return;
    setBusy(true);setNotice("");
    try{
      const method=form.id?"PATCH":"POST";
      const response=await fetch("/api/staff/counterparties",{method,headers:{"content-type":"application/json"},body:JSON.stringify(form)});
      const payload=await response.json().catch(()=>({})) as {error?:string;counterparty?:Counterparty};
      if(!response.ok){setNotice(`⚠ ${payload.error||"Не вдалося зберегти"}`);return;}
      setNotice(`✓ ${form.id?"Контрагента оновлено":"Контрагента створено"}`);await load();
      if(payload.counterparty)edit(payload.counterparty);
    }finally{setBusy(false);}
  }

  return <StaffWorkspaceShell active="finance" title="Контрагенти" description="BAS-довідник постачальників і платників. Документи посилаються на ID контрагента, а історичну назву зберігають snapshot-ом." staffName={data?.staff.displayName||data?.staff.email} staffRole={data?.staff.role}>
    {error&&<p className="financeError">{error}</p>}
    {!data&&!error&&<p className="financeLoading">Завантаження довідника…</p>}
    {data&&<div className="inventoryDocumentsLayout">
      <section className="financeJournal">
        <header className="financeToolbar"><div className="financeTabs"><button type="button" onClick={()=>window.location.assign("/staff/inventory")}>← Склад</button><button type="button" onClick={()=>window.location.assign("/staff/finance")}>Фінанси</button></div><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук: назва, код, ЄДРПОУ…"/><select value={kind} onChange={e=>setKind(e.target.value as "all"|Kind)}><option value="all">Усі типи</option>{Object.entries(KIND_UK).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={()=>void load()}>Оновити</button></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Контрагент</th><th>Тип</th><th>Код</th><th>ЄДРПОУ / ІПН</th><th>Контакт</th><th>Стан</th><th/></tr></thead><tbody>
          {rows.map(row=><tr key={row.id}><td><b>{row.name}</b><small>ID {row.id}</small></td><td>{KIND_UK[row.kind]}</td><td>{row.code||"—"}</td><td>{row.taxId||"—"}</td><td>{row.phone||row.email||"—"}{row.phone&&row.email?<small>{row.email}</small>:null}</td><td><span className={`financeState ${row.active?"state-posted":"state-cancelled"}`}>{row.active?"Активний":"Неактивний"}</span></td><td><button type="button" onClick={()=>edit(row)}>Відкрити</button></td></tr>)}
          {rows.length===0&&<tr><td colSpan={7}>Контрагентів за відбором немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="inventoryDocumentCard">
        <header><div><small>Довідник</small><h2>{form.id?`Контрагент #${form.id}`:"Новий контрагент"}</h2><p>{data.canManage?"Реквізити можна змінювати; проведені документи зберігають власний snapshot.":"Режим перегляду"}</p></div></header>
        {notice&&<p className={notice.startsWith("⚠")?"financeError":"notice"}>{notice}</p>}
        <form className="inventoryOperations" onSubmit={save}><div><label>Назва<input required disabled={!data.canManage} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Код<input disabled={!data.canManage} value={form.code} onChange={e=>setForm({...form,code:e.target.value})}/></label><label>Тип<select disabled={!data.canManage} value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as Kind})}>{Object.entries(KIND_UK).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>ЄДРПОУ / ІПН<input disabled={!data.canManage} value={form.taxId} onChange={e=>setForm({...form,taxId:e.target.value})}/></label><label>Телефон<input disabled={!data.canManage} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>E-mail<input type="email" disabled={!data.canManage} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Адреса<input disabled={!data.canManage} value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label><label><input type="checkbox" disabled={!data.canManage} checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Активний</label>{data.canManage&&<div><button className="primary" disabled={busy}>{form.id?"Записати":"Створити"}</button><button type="button" disabled={busy} onClick={reset}>Новий</button></div>}</div></form>
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
