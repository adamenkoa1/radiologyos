"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type Warehouse={id:number;code:string;name:string;active:number;isDefault:number};
type Balance={warehouseId:number;warehouseCode:string;warehouseName:string;lotId:number;itemId:number;itemName:string;lotNumber:string;stock:number};
type Item={id:number;unit:string};
type Staff={email:string;displayName:string;role:string};
type CountState="draft"|"posted"|"reversed"|"cancelled";
type CountDoc={id:number;number:string;occurredAt:string;state:CountState;comment:string;createdBy:string;createdAt:string;postedBy:string;postedAt:string;lineCount?:number;totalBookQuantity?:number;totalCountedQuantity?:number;discrepancyQuantity?:number};
type CountLine={id:number;lineNo:number;itemId:number;lotId:number;warehouseId:number;warehouseCode:string;warehouseName:string;itemName:string;itemUnit:string;lotNumber:string;bookQuantity:number;countedQuantity:number;discrepancyQuantity:number;reason:string};
type CountDetail={document:CountDoc;lines:CountLine[]};
type DraftLine={warehouseId:number;lotId:number;itemId:number;itemName:string;lotNumber:string;unit:string;bookQuantity:number;countedQuantity:string;reason:string};
type InventoryPayload={warehouses:Warehouse[];warehouseBalances:Balance[];items:Item[];staff:Staff;canManage:boolean;error?:string};
type CountsPayload={documents:CountDoc[];staff:Staff;canManage:boolean;error?:string};

function stateLabel(state:CountState){return state==="draft"?"Чернетка":state==="posted"?"Проведено":state==="cancelled"?"Скасовано":state==="reversed"?"Сторновано":state;}
function fmt(value:number|undefined){return Number(value||0).toLocaleString("uk-UA",{maximumFractionDigits:3});}
function fmtDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString("uk-UA",{dateStyle:"short",timeStyle:"short"});}

export default function InventoryCountsPage(){
  const [inventory,setInventory]=useState<InventoryPayload|null>(null);
  const [documents,setDocuments]=useState<CountDoc[]>([]);
  const [selected,setSelected]=useState<CountDetail|null>(null);
  const [warehouseId,setWarehouseId]=useState(0);
  const [candidateLotId,setCandidateLotId]=useState(0);
  const [lines,setLines]=useState<DraftLine[]>([]);
  const [comment,setComment]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);

  const load=useCallback(async()=>{
    const [inventoryResponse,countsResponse]=await Promise.all([
      fetch("/api/staff/inventory",{cache:"no-store"}),
      fetch("/api/staff/inventory/counts",{cache:"no-store"}),
    ]);
    const inv=await inventoryResponse.json().catch(()=>({})) as InventoryPayload;
    const counts=await countsResponse.json().catch(()=>({})) as CountsPayload;
    if(!inventoryResponse.ok)throw new Error(inv.error||"Не вдалося завантажити складські залишки");
    if(!countsResponse.ok)throw new Error(counts.error||"Не вдалося завантажити інвентаризації");
    setInventory(inv);setDocuments(counts.documents||[]);setError("");
    const active=inv.warehouses.filter(row=>row.active);
    const preferred=active.find(row=>row.isDefault)||active[0];
    if(preferred)setWarehouseId(current=>current||preferred.id);
  },[]);

  useEffect(()=>{const timer=window.setTimeout(()=>void load().catch(e=>setError(e instanceof Error?e.message:"Помилка")),0);return()=>window.clearTimeout(timer);},[load]);

  const activeWarehouses=useMemo(()=>inventory?.warehouses.filter(row=>row.active)||[],[inventory]);
  const itemUnits=useMemo(()=>new Map((inventory?.items||[]).map(item=>[item.id,item.unit])),[inventory]);
  const warehouseBalances=useMemo(()=>(inventory?.warehouseBalances||[]).filter(row=>row.warehouseId===warehouseId),[inventory,warehouseId]);
  const availableBalances=useMemo(()=>warehouseBalances.filter(row=>!lines.some(line=>line.warehouseId===row.warehouseId&&line.lotId===row.lotId)),[warehouseBalances,lines]);
  const effectiveCandidateLotId=availableBalances.some(row=>row.lotId===candidateLotId)?candidateLotId:(availableBalances[0]?.lotId||0);
  const candidate=availableBalances.find(row=>row.lotId===effectiveCandidateLotId)||null;
  const draftDiscrepancy=useMemo(()=>lines.reduce((sum,line)=>{const counted=Number(line.countedQuantity);return sum+(Number.isFinite(counted)?counted-line.bookQuantity:0);},0),[lines]);

  function changeWarehouse(next:number){setWarehouseId(next);setCandidateLotId(0);}
  function addLine(){
    if(!candidate||lines.length>=200)return;
    setLines(current=>[...current,{
      warehouseId:candidate.warehouseId,lotId:candidate.lotId,itemId:candidate.itemId,itemName:candidate.itemName,
      lotNumber:candidate.lotNumber,unit:itemUnits.get(candidate.itemId)||"",bookQuantity:Number(candidate.stock),
      countedQuantity:String(candidate.stock),reason:"Інвентаризація",
    }]);
    setCandidateLotId(0);
  }
  function addWarehouseBalances(){
    const room=Math.max(0,200-lines.length);
    if(!room)return;
    const additions=availableBalances.slice(0,room).map(row=>({
      warehouseId:row.warehouseId,lotId:row.lotId,itemId:row.itemId,itemName:row.itemName,lotNumber:row.lotNumber,
      unit:itemUnits.get(row.itemId)||"",bookQuantity:Number(row.stock),countedQuantity:String(row.stock),reason:"Інвентаризація",
    }));
    setLines(current=>[...current,...additions]);setCandidateLotId(0);
  }
  function updateLine(index:number,patch:Partial<Pick<DraftLine,"countedQuantity"|"reason">>){setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));}
  function removeLine(index:number){setLines(current=>current.filter((_,i)=>i!==index));}

  async function openDocument(id:number){
    const response=await fetch(`/api/staff/inventory/counts?id=${id}`,{cache:"no-store"});
    const payload=await response.json().catch(()=>({})) as CountDetail&{error?:string};
    if(!response.ok){setNotice(`⚠ ${payload.error||"Не вдалося відкрити інвентаризацію"}`);return;}
    setSelected(payload);setNotice("");
  }

  async function create(event:React.FormEvent){
    event.preventDefault();
    if(!inventory?.canManage||!lines.length)return;
    const normalized=lines.map(line=>({...line,countedQuantity:Number(line.countedQuantity)}));
    if(normalized.some(line=>!Number.isFinite(line.countedQuantity)||line.countedQuantity<0)){setNotice("⚠ Фактична кількість має бути нуль або більше");return;}
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/staff/inventory/counts",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"create",comment,lines:normalized.map(line=>({warehouseId:line.warehouseId,lotId:line.lotId,countedQuantity:line.countedQuantity,reason:line.reason}))}),
      });
      const payload=await response.json().catch(()=>({})) as CountDetail&{error?:string};
      if(!response.ok){setNotice(`⚠ ${payload.error||"Не вдалося створити інвентаризацію"}`);return;}
      setSelected(payload);setLines([]);setComment("");setCandidateLotId(0);setNotice(`✓ Створено чернетку ${payload.document.number}`);
      await load();
    }finally{setBusy(false);}
  }

  async function action(kind:"post"|"cancel"){
    if(!selected)return;setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/staff/inventory/counts",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:kind,documentId:selected.document.id}),
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setNotice(`⚠ ${payload.error||"Операцію не виконано"}`);return;}
      setNotice(kind==="post"?"✓ Інвентаризацію проведено":"✓ Чернетку скасовано");
      await load();await openDocument(selected.document.id);
    }finally{setBusy(false);}
  }

  return <StaffWorkspaceShell active="inventory" title="Інвентаризація" description="Фіксація фактичних залишків із серверним знімком облікового балансу та контрольованим коригуванням при проведенні." staffName={inventory?.staff.displayName||inventory?.staff.email} staffRole={inventory?.staff.role}>
    {error&&<p className="financeError">{error}</p>}
    {!inventory&&!error&&<p className="financeLoading">Завантаження…</p>}
    {inventory&&<div className="inventoryDocumentsLayout">
      <section className="financeJournal">
        <header className="financeToolbar"><div className="financeTabs"><button type="button" onClick={()=>window.location.assign("/staff/inventory")}>← Складський облік</button><button type="button" onClick={()=>window.location.assign("/staff/inventory/transfers")}>Переміщення</button><button type="button" onClick={()=>window.location.assign("/staff/warehouses")}>Склади</button></div><button type="button" onClick={()=>void load()}>Оновити</button></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Документ</th><th>Дата</th><th>Стан</th><th>Рядків</th><th>Облік</th><th>Факт</th><th>Δ</th><th/></tr></thead><tbody>
          {documents.map(row=><tr key={row.id}><td><b>{row.number}</b><small>{row.comment||"Інвентаризація"}</small></td><td>{fmtDate(row.occurredAt)}</td><td><span className={`financeState state-${row.state}`}>{stateLabel(row.state)}</span></td><td>{row.lineCount||0}</td><td>{fmt(row.totalBookQuantity)}</td><td>{fmt(row.totalCountedQuantity)}</td><td>{fmt(row.discrepancyQuantity)}</td><td><button type="button" onClick={()=>void openDocument(row.id)}>Відкрити</button></td></tr>)}
          {documents.length===0&&<tr><td colSpan={8}>Інвентаризацій ще немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="inventoryDocumentCard">
        <header><div><small>Новий документ</small><h2>Інвентаризація запасів</h2><p>Обліковий залишок у документі визначає сервер у момент створення. Перед проведенням D1 повторно перевіряє баланс; якщо були інші рухи, проведення блокується як застаріле.</p></div></header>
        {notice&&<p className={notice.startsWith("⚠")?"financeError":"notice"}>{notice}</p>}
        <form className="inventoryOperations" onSubmit={create}><div>
          <label>Склад<select value={warehouseId} onChange={e=>changeWarehouse(Number(e.target.value))}>{activeWarehouses.map(row=><option key={row.id} value={row.id}>{row.name} {row.code?`(${row.code})`:""}</option>)}</select></label>
          <label>Партія<select value={effectiveCandidateLotId} onChange={e=>setCandidateLotId(Number(e.target.value))}><option value={0}>Оберіть партію…</option>{availableBalances.map(row=><option key={`${row.warehouseId}-${row.lotId}`} value={row.lotId}>{row.itemName} · {row.lotNumber||`lot #${row.lotId}`} · облік {fmt(row.stock)}</option>)}</select></label>
          <div><button type="button" disabled={!candidate||lines.length>=200} onClick={addLine}>Додати рядок</button><button type="button" disabled={!availableBalances.length||lines.length>=200} onClick={addWarehouseBalances}>Додати всі залишки складу</button></div>
          {lines.length>0&&<div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Матеріал / партія</th><th>Облік</th><th>Факт</th><th>Δ</th><th>Причина</th><th/></tr></thead><tbody>{lines.map((line,index)=>{const counted=Number(line.countedQuantity);const discrepancy=Number.isFinite(counted)?counted-line.bookQuantity:0;return <tr key={`${line.warehouseId}-${line.lotId}`}><td><b>{line.itemName}</b><small>{line.lotNumber||`lot #${line.lotId}`} · {line.unit}</small></td><td>{fmt(line.bookQuantity)}</td><td><input aria-label={`Фактична кількість ${line.itemName}`} type="number" min="0" step="any" required value={line.countedQuantity} onChange={e=>updateLine(index,{countedQuantity:e.target.value})}/></td><td>{fmt(discrepancy)}</td><td><input aria-label={`Причина ${line.itemName}`} value={line.reason} maxLength={500} onChange={e=>updateLine(index,{reason:e.target.value})}/></td><td><button type="button" onClick={()=>removeLine(index)}>Прибрати</button></td></tr>;})}</tbody></table></div>}
          <label>Коментар<input value={comment} onChange={e=>setComment(e.target.value)} maxLength={500} placeholder="Наприклад: планова інвентаризація"/></label>
          {lines.length>0&&<p><b>Попередня сумарна розбіжність:</b> {fmt(draftDiscrepancy)}. Остаточні облікові значення фіксує сервер.</p>}
          {inventory.canManage&&<button className="primary" disabled={busy||!lines.length}>Створити чернетку</button>}
        </div></form>

        {selected&&<div className="inventoryOperations"><h3>{selected.document.number} · {stateLabel(selected.document.state)}</h3>
          <p><small>{fmtDate(selected.document.occurredAt)}{selected.document.comment?` · ${selected.document.comment}`:""}</small></p>
          <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Матеріал / партія</th><th>Склад</th><th>Облік</th><th>Факт</th><th>Δ</th></tr></thead><tbody>{selected.lines.map(line=><tr key={line.id}><td><b>{line.itemName}</b><small>{line.lotNumber||`lot #${line.lotId}`} · {line.itemUnit}</small></td><td>{line.warehouseName}</td><td>{fmt(line.bookQuantity)}</td><td>{fmt(line.countedQuantity)}</td><td>{fmt(line.discrepancyQuantity)}</td></tr>)}</tbody></table></div>
          {inventory.canManage&&selected.document.state==="draft"&&<div><button className="primary" disabled={busy} type="button" onClick={()=>void action("post")}>Провести коригування</button><button disabled={busy} type="button" onClick={()=>void action("cancel")}>Скасувати чернетку</button></div>}
        </div>}
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
