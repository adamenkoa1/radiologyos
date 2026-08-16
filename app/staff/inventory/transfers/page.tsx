"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type Warehouse={id:number;code:string;name:string;active:number;isDefault:number};
type Balance={warehouseId:number;warehouseCode:string;warehouseName:string;lotId:number;itemId:number;itemName:string;lotNumber:string;stock:number};
type Staff={email:string;displayName:string;role:string};
type TransferDoc={id:number;number:string;occurredAt:string;state:string;comment:string;lineCount:number;totalQuantity:number};
type TransferLine={id:number;itemName:string;unit:string;lotId:number;lotNumber:string;quantity:number;reason:string;sourceWarehouseName:string;destinationWarehouseName:string};
type Detail={document:TransferDoc;lines:TransferLine[]};

type InventoryPayload={warehouses:Warehouse[];warehouseBalances:Balance[];staff:Staff;canManage:boolean;error?:string};
type TransferPayload={documents:TransferDoc[];staff:Staff;canManage:boolean;error?:string};

function stateLabel(state:string){return state==="draft"?"Чернетка":state==="posted"?"Проведено":state==="cancelled"?"Скасовано":state==="reversed"?"Сторновано":state;}

export default function InventoryTransfersPage(){
  const [inventory,setInventory]=useState<InventoryPayload|null>(null);
  const [documents,setDocuments]=useState<TransferDoc[]>([]);
  const [selected,setSelected]=useState<Detail|null>(null);
  const [sourceWarehouseId,setSourceWarehouseId]=useState(0);
  const [destinationWarehouseId,setDestinationWarehouseId]=useState(0);
  const [lotId,setLotId]=useState(0);
  const [quantity,setQuantity]=useState(1);
  const [reason,setReason]=useState("Переміщення між складами");
  const [comment,setComment]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);

  const load=useCallback(async()=>{
    const [invRes,docRes]=await Promise.all([
      fetch("/api/staff/inventory",{cache:"no-store"}),
      fetch("/api/staff/inventory/transfers",{cache:"no-store"}),
    ]);
    const inv=await invRes.json().catch(()=>({})) as InventoryPayload;
    const docs=await docRes.json().catch(()=>({})) as TransferPayload;
    if(!invRes.ok)throw new Error(inv.error||"Не вдалося завантажити складські залишки");
    if(!docRes.ok)throw new Error(docs.error||"Не вдалося завантажити переміщення");
    setInventory(inv);setDocuments(docs.documents||[]);setError("");
    const active=inv.warehouses.filter(w=>w.active);
    const main=active.find(w=>w.isDefault)||active[0];
    if(main)setSourceWarehouseId(current=>current||main.id);
  },[]);

  useEffect(()=>{const timer=window.setTimeout(()=>void load().catch(e=>setError(e instanceof Error?e.message:"Помилка")),0);return()=>window.clearTimeout(timer);},[load]);

  const activeWarehouses=useMemo(()=>inventory?.warehouses.filter(w=>w.active)||[],[inventory]);
  const sourceBalances=useMemo(()=>{
    const rows=(inventory?.warehouseBalances||[]).filter(row=>row.warehouseId===sourceWarehouseId&&Number(row.stock)>0.000001);
    return rows.sort((a,b)=>`${a.itemName} ${a.lotNumber}`.localeCompare(`${b.itemName} ${b.lotNumber}`,"uk"));
  },[inventory,sourceWarehouseId]);
  const selectedBalance=sourceBalances.find(row=>row.lotId===lotId)||null;

  useEffect(()=>{
    if(sourceBalances.length===0){setLotId(0);return;}
    if(!sourceBalances.some(row=>row.lotId===lotId))setLotId(sourceBalances[0].lotId);
  },[sourceBalances,lotId]);
  useEffect(()=>{
    if(destinationWarehouseId===sourceWarehouseId)setDestinationWarehouseId(0);
  },[sourceWarehouseId,destinationWarehouseId]);

  async function openDocument(id:number){
    const response=await fetch(`/api/staff/inventory/transfers?id=${id}`,{cache:"no-store"});
    const payload=await response.json().catch(()=>({})) as Detail&{error?:string};
    if(!response.ok){setNotice(`⚠ ${payload.error||"Не вдалося відкрити документ"}`);return;}
    setSelected(payload);setNotice("");
  }

  async function create(event:React.FormEvent){
    event.preventDefault();if(!inventory?.canManage||!lotId||!sourceWarehouseId||!destinationWarehouseId)return;
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/staff/inventory/transfers",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"create",comment,lines:[{lotId,sourceWarehouseId,destinationWarehouseId,quantity,reason}]}),
      });
      const payload=await response.json().catch(()=>({})) as Detail&{error?:string};
      if(!response.ok){setNotice(`⚠ ${payload.error||"Не вдалося створити переміщення"}`);return;}
      setSelected(payload);setNotice(`✓ Створено чернетку ${payload.document.number}`);setComment("");
      await load();
    }finally{setBusy(false);}
  }

  async function action(kind:"post"|"cancel"){
    if(!selected)return;setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/staff/inventory/transfers",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:kind,documentId:selected.document.id}),
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setNotice(`⚠ ${payload.error||"Операцію не виконано"}`);return;}
      setNotice(kind==="post"?"✓ Переміщення проведено":"✓ Чернетку скасовано");
      await load();await openDocument(selected.document.id);
    }finally{setBusy(false);}
  }

  return <StaffWorkspaceShell active="inventory" title="Переміщення запасів" description="BAS-документ: списання зі складу-відправника і одночасне оприбуткування тієї самої партії на склад-одержувач." staffName={inventory?.staff.displayName||inventory?.staff.email} staffRole={inventory?.staff.role}>
    {error&&<p className="financeError">{error}</p>}
    {!inventory&&!error&&<p className="financeLoading">Завантаження…</p>}
    {inventory&&<div className="inventoryDocumentsLayout">
      <section className="financeJournal">
        <header className="financeToolbar"><div className="financeTabs"><button type="button" onClick={()=>window.location.assign("/staff/inventory")}>← Складський облік</button><button type="button" onClick={()=>window.location.assign("/staff/warehouses")}>Склади</button></div><button type="button" onClick={()=>void load()}>Оновити</button></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Документ</th><th>Дата</th><th>Стан</th><th>Рядків</th><th>Кількість</th><th/></tr></thead><tbody>
          {documents.map(row=><tr key={row.id}><td><b>{row.number}</b><small>{row.comment||"Переміщення між складами"}</small></td><td>{new Date(row.occurredAt).toLocaleString("uk-UA")}</td><td><span className={`financeState state-${row.state}`}>{stateLabel(row.state)}</span></td><td>{row.lineCount}</td><td>{row.totalQuantity}</td><td><button type="button" onClick={()=>void openDocument(row.id)}>Відкрити</button></td></tr>)}
          {documents.length===0&&<tr><td colSpan={6}>Переміщень ще немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="inventoryDocumentCard">
        <header><div><small>Новий документ</small><h2>Переміщення запасів</h2><p>Залишок перевіряється тільки на складі-відправнику. Склад-одержувач не створює нову партію — переноситься той самий lot.</p></div></header>
        {notice&&<p className={notice.startsWith("⚠")?"financeError":"notice"}>{notice}</p>}
        <form className="inventoryOperations" onSubmit={create}><div>
          <label>Склад-відправник<select value={sourceWarehouseId} onChange={e=>setSourceWarehouseId(Number(e.target.value))}>{activeWarehouses.map(w=><option key={w.id} value={w.id}>{w.name} {w.code?`(${w.code})`:""}</option>)}</select></label>
          <label>Партія<select value={lotId} onChange={e=>setLotId(Number(e.target.value))}><option value={0}>Оберіть партію…</option>{sourceBalances.map(row=><option key={`${row.warehouseId}-${row.lotId}`} value={row.lotId}>{row.itemName} · {row.lotNumber||`lot #${row.lotId}`} · залишок {row.stock}</option>)}</select></label>
          <label>Склад-одержувач<select value={destinationWarehouseId} onChange={e=>setDestinationWarehouseId(Number(e.target.value))}><option value={0}>Оберіть склад…</option>{activeWarehouses.filter(w=>w.id!==sourceWarehouseId).map(w=><option key={w.id} value={w.id}>{w.name} {w.code?`(${w.code})`:""}</option>)}</select></label>
          <label>Кількість<input type="number" min="0.000001" step="any" required value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/>{selectedBalance&&<small>Доступно: {selectedBalance.stock}</small>}</label>
          <label>Підстава<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>
          <label>Коментар<input value={comment} onChange={e=>setComment(e.target.value)} maxLength={500}/></label>
          {inventory.canManage&&<button className="primary" disabled={busy||!lotId||!destinationWarehouseId||quantity<=0}>Створити чернетку</button>}
        </div></form>

        {selected&&<div className="inventoryOperations"><h3>{selected.document.number} · {stateLabel(selected.document.state)}</h3>
          {selected.lines.map(line=><p key={line.id}><b>{line.itemName}</b> · партія {line.lotNumber||line.lotId} · {line.quantity} {line.unit}<br/><small>{line.sourceWarehouseName} → {line.destinationWarehouseName} · {line.reason}</small></p>)}
          {inventory.canManage&&selected.document.state==="draft"&&<div><button className="primary" disabled={busy} type="button" onClick={()=>void action("post")}>Провести</button><button disabled={busy} type="button" onClick={()=>void action("cancel")}>Скасувати чернетку</button></div>}
        </div>}
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
