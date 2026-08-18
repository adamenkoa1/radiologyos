"use client";

import { useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";
import {bookQuantityForBucket,discrepancy,initialCountSheet,normalizeCountSheet,type CountSheetLine} from "../../../../lib/inventory-count-workspace";

type Staff={email:string;displayName:string;role:string};
type Warehouse={id:number;code:string;name:string;active:number;isDefault:number};
type Lot={id:number;itemId:number;itemName:string;lotNumber:string;stock:number};
type Balance={warehouseId:number;lotId:number;stock:number};
type InventoryPayload={warehouses:Warehouse[];lots:Lot[];warehouseBalances:Balance[];staff:Staff;error?:string};
type CountSummary={id:number;number:string;occurredAt:string;state:string;comment:string;lineCount:number;totalBookQuantity:number;totalCountedQuantity:number;discrepancyQuantity:number};
type CountLine={id:number;lineNo:number;itemId:number;lotId:number;warehouseId:number;warehouseName:string;itemName:string;itemUnit:string;lotNumber:string;bookQuantity:number;countedQuantity:number;discrepancyQuantity:number;reason:string};
type CountDetail={document:CountSummary;lines:CountLine[];staff?:Staff;canManage?:boolean;error?:string};
type CountsPayload={documents:CountSummary[];staff:Staff;canManage:boolean;error?:string};

const STATE_UK:Record<string,string>={draft:"Чернетка",posted:"Проведено",cancelled:"Скасовано",reversed:"Сторновано"};
function fmt(value:number){return Number(value||0).toLocaleString("uk-UA",{maximumFractionDigits:2});}
function dt(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString("uk-UA",{dateStyle:"short",timeStyle:"short"});}

export default function InventoryCountsPage(){
  const [inventory,setInventory]=useState<InventoryPayload|null>(null);
  const [documents,setDocuments]=useState<CountSummary[]>([]);
  const [selected,setSelected]=useState<CountDetail|null>(null);
  const [warehouseId,setWarehouseId]=useState(0);
  const [sheet,setSheet]=useState<CountSheetLine[]>([]);
  const [lotToAdd,setLotToAdd]=useState(0);
  const [comment,setComment]=useState("");
  const [error,setError]=useState("");
  const [toast,setToast]=useState("");
  const [busy,setBusy]=useState(false);
  const [canManage,setCanManage]=useState(false);

  async function load(){
    try{
      const [inventoryResponse,countsResponse]=await Promise.all([
        fetch("/api/staff/inventory",{cache:"no-store"}),
        fetch("/api/staff/inventory/counts",{cache:"no-store"}),
      ]);
      const inv=await inventoryResponse.json().catch(()=>({})) as InventoryPayload;
      const counts=await countsResponse.json().catch(()=>({})) as CountsPayload;
      if(!inventoryResponse.ok)throw new Error(inv.error||"Не вдалося завантажити склад");
      if(!countsResponse.ok)throw new Error(counts.error||"Не вдалося завантажити інвентаризації");
      setInventory(inv);setDocuments(counts.documents||[]);setCanManage(!!counts.canManage);setError("");
      const fallback=inv.warehouses.find(w=>w.active&&w.isDefault)||inv.warehouses.find(w=>w.active);
      if(fallback&&!warehouseId){
        setWarehouseId(fallback.id);
        setSheet(initialCountSheet(fallback.id,inv.lots,inv.warehouseBalances));
      }
    }catch(e){setError(e instanceof Error?e.message:"Не вдалося завантажити інвентаризації");}
  }
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);/* eslint-disable-next-line react-hooks/exhaustive-deps */},[]);

  const activeWarehouses=useMemo(()=>inventory?.warehouses.filter(w=>w.active)||[],[inventory]);
  const lotMap=useMemo(()=>new Map((inventory?.lots||[]).map(lot=>[lot.id,lot])),[inventory]);
  const availableLots=useMemo(()=>{
    const used=new Set(sheet.map(line=>line.lotId));
    return (inventory?.lots||[]).filter(lot=>!used.has(lot.id));
  },[inventory,sheet]);

  function changeWarehouse(id:number){
    setWarehouseId(id);setLotToAdd(0);setSelected(null);
    if(inventory)setSheet(initialCountSheet(id,inventory.lots,inventory.warehouseBalances));
  }
  function addLot(){
    if(!inventory||!warehouseId||!lotToAdd)return;
    const book=bookQuantityForBucket(inventory.warehouseBalances,warehouseId,lotToAdd);
    setSheet(current=>[...current,{warehouseId,lotId:lotToAdd,countedQuantity:book}]);setLotToAdd(0);
  }
  function setCounted(lotId:number,value:number){
    setSheet(current=>current.map(line=>line.lotId===lotId?{...line,countedQuantity:value}:line));
  }
  async function createDraft(){
    setBusy(true);setToast("");
    try{
      const lines=normalizeCountSheet(sheet);
      if(!lines.length)throw new Error("Додайте хоча б один рядок інвентаризації");
      const response=await fetch("/api/staff/inventory/counts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"create",comment,lines})});
      const payload=await response.json().catch(()=>({})) as CountDetail;
      if(!response.ok)throw new Error(payload.error||"Не вдалося створити інвентаризацію");
      setSelected(payload);setToast("✓ Чернетку інвентаризації створено");setComment("");await load();
    }catch(e){setToast(`⚠ ${e instanceof Error?e.message:"Помилка інвентаризації"}`);}finally{setBusy(false);}
  }
  async function openCount(id:number){
    setBusy(true);setToast("");
    try{
      const response=await fetch(`/api/staff/inventory/counts?id=${id}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as CountDetail;
      if(!response.ok)throw new Error(payload.error||"Інвентаризацію не знайдено");
      setSelected(payload);
    }catch(e){setToast(`⚠ ${e instanceof Error?e.message:"Помилка інвентаризації"}`);}finally{setBusy(false);}
  }
  async function documentAction(action:"post"|"cancel"){
    if(!selected)return;setBusy(true);setToast("");
    try{
      const response=await fetch("/api/staff/inventory/counts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,documentId:selected.document.id})});
      const payload=await response.json().catch(()=>({})) as CountDetail&{ok?:boolean};
      if(!response.ok)throw new Error(payload.error||"Не вдалося виконати дію");
      setToast(action==="post"?"✓ Інвентаризацію проведено":"✓ Чернетку скасовано");setSelected(null);await load();
      if(inventory){
        const invResponse=await fetch("/api/staff/inventory",{cache:"no-store"});const inv=await invResponse.json() as InventoryPayload;
        setInventory(inv);setSheet(initialCountSheet(warehouseId,inv.lots,inv.warehouseBalances));
      }
    }catch(e){setToast(`⚠ ${e instanceof Error?e.message:"Помилка інвентаризації"}`);}finally{setBusy(false);}
  }

  return <StaffWorkspaceShell active="inventory" title="Інвентаризація" description="BAS-документ фактичного перерахунку: обліковий залишок фіксує сервер, проведення створює лише різницю в immutable регістрі." staffName={inventory?.staff.displayName||inventory?.staff.email} staffRole={inventory?.staff.role}>
    {error&&<p className="notice error">{error}</p>}
    {toast&&<p className={`inventoryToast${toast.startsWith("⚠")?" warn":""}`} role="status">{toast}</p>}
    <div className="inventoryTabs"><button onClick={()=>window.location.assign("/staff/inventory")}>← Склад</button><button className="active">Інвентаризації <span className="inventoryTabCount">{documents.length}</span></button></div>

    {inventory&&canManage&&<section className="financeJournal">
      <header className="financeToolbar"><div><b>Новий перерахунок</b><small>Фактична кількість може бути 0. Обліковий залишок і дельту UI не надсилає.</small></div>
        <label><span>Склад</span><select value={warehouseId} onChange={e=>changeWarehouse(Number(e.target.value))}>{activeWarehouses.map(w=><option key={w.id} value={w.id}>{w.name} · {w.code}</option>)}</select></label>
        <button type="button" disabled={busy||sheet.length===0} onClick={()=>void createDraft()}>Створити чернетку</button>
      </header>
      <div className="inventoryToolbar"><select value={lotToAdd} onChange={e=>setLotToAdd(Number(e.target.value))}><option value={0}>Додати партію з нульовим/іншим залишком…</option>{availableLots.map(lot=><option key={lot.id} value={lot.id}>{lot.itemName} · партія {lot.lotNumber||`#${lot.id}`}</option>)}</select><button type="button" disabled={!lotToAdd} onClick={addLot}>Додати</button><input value={comment} onChange={e=>setComment(e.target.value)} placeholder="Коментар до інвентаризації" maxLength={500}/></div>
      <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Матеріал / партія</th><th className="num">Обліковий</th><th className="num">Фактичний</th><th className="num">Різниця</th><th/></tr></thead><tbody>
        {sheet.map(line=>{const lot=lotMap.get(line.lotId);const book=inventory?bookQuantityForBucket(inventory.warehouseBalances,line.warehouseId,line.lotId):0;const delta=discrepancy(book,line.countedQuantity);return <tr key={`${line.warehouseId}-${line.lotId}`}><td><b>{lot?.itemName||`Lot #${line.lotId}`}</b><small>{lot?.lotNumber||`#${line.lotId}`}</small></td><td className="num">{fmt(book)}</td><td className="num"><input type="number" min="0" step="0.01" value={line.countedQuantity} onChange={e=>setCounted(line.lotId,Number(e.target.value))}/></td><td className={`num ${delta<0?"negative":delta>0?"positive":""}`}>{delta>0?"+":""}{fmt(delta)}</td><td><button type="button" onClick={()=>setSheet(current=>current.filter(row=>row!==line))}>Прибрати</button></td></tr>;})}
        {sheet.length===0&&<tr><td colSpan={5}>Додайте хоча б одну партію.</td></tr>}
      </tbody></table></div>
    </section>}

    <section className="financeJournal"><header className="financeToolbar"><div><b>Журнал інвентаризацій</b><small>Проведений документ незмінний; stale balance вимагає нової інвентаризації.</small></div><button onClick={()=>void load()} disabled={busy}>Оновити</button></header>
      <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Документ</th><th>Дата</th><th>Стан</th><th className="num">Обліковий</th><th className="num">Фактичний</th><th className="num">Різниця</th><th/></tr></thead><tbody>{documents.map(doc=><tr key={doc.id}><td><b>{doc.number}</b><small>{doc.lineCount} ряд.</small></td><td>{dt(doc.occurredAt)}</td><td>{STATE_UK[doc.state]||doc.state}</td><td className="num">{fmt(doc.totalBookQuantity)}</td><td className="num">{fmt(doc.totalCountedQuantity)}</td><td className={`num ${doc.discrepancyQuantity<0?"negative":doc.discrepancyQuantity>0?"positive":""}`}>{doc.discrepancyQuantity>0?"+":""}{fmt(doc.discrepancyQuantity)}</td><td><button onClick={()=>void openCount(doc.id)}>Відкрити</button></td></tr>)}{documents.length===0&&<tr><td colSpan={7}>Інвентаризацій ще немає.</td></tr>}</tbody></table></div>
    </section>

    {selected&&<section className="financeJournal"><header className="financeToolbar"><div><b>{selected.document.number}</b><small>{STATE_UK[selected.document.state]||selected.document.state}</small></div>{canManage&&selected.document.state==="draft"&&<><button disabled={busy} onClick={()=>void documentAction("post")}>Провести</button><button disabled={busy} onClick={()=>void documentAction("cancel")}>Скасувати</button></>}</header>
      <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Склад</th><th>Матеріал / партія</th><th className="num">Обліковий snapshot</th><th className="num">Фактичний</th><th className="num">Різниця</th></tr></thead><tbody>{selected.lines.map(line=><tr key={line.id}><td>{line.warehouseName}</td><td><b>{line.itemName}</b><small>{line.lotNumber||`#${line.lotId}`} · {line.itemUnit}</small></td><td className="num">{fmt(line.bookQuantity)}</td><td className="num">{fmt(line.countedQuantity)}</td><td className={`num ${line.discrepancyQuantity<0?"negative":line.discrepancyQuantity>0?"positive":""}`}>{line.discrepancyQuantity>0?"+":""}{fmt(line.discrepancyQuantity)}</td></tr>)}</tbody></table></div>
    </section>}
  </StaffWorkspaceShell>;
}
