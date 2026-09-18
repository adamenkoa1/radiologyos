"use client";

import { useCallback,useEffect,useMemo,useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type Staff={email:string;displayName:string;role:string};
type Balance={warehouseId:number;warehouseCode:string;warehouseName:string;lotId:number;itemId:number;itemName:string;lotNumber:string;stock:number};
type InventoryPayload={warehouseBalances:Balance[];staff:Staff;canManage:boolean;error?:string};
type MaterialRow={
  reservationId:number;bookingId:number;bookingCode:string;performedAt:string;
  serviceCode:string;serviceTitle:string;itemId:number;itemName:string;itemUnit:string;
  warehouseId:number;warehouseCode:string;warehouseName:string;
  plannedQuantity:number;draftQuantity:number;postedQuantity:number;remainingQuantity:number;
  status:"open"|"partial"|"draft"|"consumed";
};
type QueuePayload={rows:MaterialRow[];canManage:boolean;error?:string};
type Allocation={lotId:number;quantity:string};
type CreatedPayload={document?:{id:number;number:string};error?:string};

const EPS=0.000001;
function fmt(value:number){return Number(value||0).toLocaleString("uk-UA",{maximumFractionDigits:3});}
function fmtDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?(value||"—"):date.toLocaleString("uk-UA",{dateStyle:"short",timeStyle:"short"});}
function statusLabel(status:MaterialRow["status"]){return status==="open"?"До списання":status==="partial"?"Частково списано":status==="draft"?"Є чернетка":"Списано";}

export default function MaterialConsumptionPage(){
  const [inventory,setInventory]=useState<InventoryPayload|null>(null);
  const [rows,setRows]=useState<MaterialRow[]>([]);
  const [canManage,setCanManage]=useState(false);
  const [selectedReservationId,setSelectedReservationId]=useState(0);
  const [allocations,setAllocations]=useState<Allocation[]>([]);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);

  const load=useCallback(async()=>{
    const [inventoryResponse,queueResponse]=await Promise.all([
      fetch("/api/staff/inventory",{cache:"no-store"}),
      fetch("/api/staff/material-consumption",{cache:"no-store"}),
    ]);
    const inv=await inventoryResponse.json().catch(()=>({})) as InventoryPayload;
    const queue=await queueResponse.json().catch(()=>({})) as QueuePayload;
    if(!inventoryResponse.ok)throw new Error(inv.error||"Не вдалося завантажити складські залишки");
    if(!queueResponse.ok)throw new Error(queue.error||"Не вдалося завантажити чергу фактичного списання");
    setInventory(inv);setRows(queue.rows||[]);setCanManage(Boolean(queue.canManage));setError("");
  },[]);

  useEffect(()=>{const timer=window.setTimeout(()=>void load().catch(e=>setError(e instanceof Error?e.message:"Помилка")),0);return()=>window.clearTimeout(timer);},[load]);

  const selected=useMemo(()=>rows.find(row=>row.reservationId===selectedReservationId)||null,[rows,selectedReservationId]);
  const eligibleBalances=useMemo(()=>{
    if(!inventory||!selected)return[];
    return inventory.warehouseBalances
      .filter(row=>row.warehouseId===selected.warehouseId&&row.itemId===selected.itemId&&Number(row.stock)>EPS)
      .sort((a,b)=>`${a.lotNumber} ${a.lotId}`.localeCompare(`${b.lotNumber} ${b.lotId}`,"uk"));
  },[inventory,selected]);
  const balanceByLot=useMemo(()=>new Map(eligibleBalances.map(row=>[row.lotId,row])),[eligibleBalances]);
  const allocationTotal=useMemo(()=>allocations.reduce((sum,row)=>{const n=Number(row.quantity);return sum+(Number.isFinite(n)&&n>0?n:0);},0),[allocations]);
  const unallocated=selected?Math.max(0,Number(selected.remainingQuantity)-allocationTotal):0;
  const hasInvalidAllocation=allocations.some(row=>{
    const quantity=Number(row.quantity),balance=balanceByLot.get(row.lotId);
    return !balance||!Number.isFinite(quantity)||quantity<=0||quantity>Number(balance.stock)+EPS;
  });
  const hasDuplicateLot=new Set(allocations.map(row=>row.lotId)).size!==allocations.length;
  const canCreate=Boolean(selected&&canManage&&allocations.length>0&&!hasInvalidAllocation&&!hasDuplicateLot&&allocationTotal>EPS&&allocationTotal<=selected.remainingQuantity+EPS);

  function choose(row:MaterialRow){
    setSelectedReservationId(row.reservationId);setNotice("");
    const first=(inventory?.warehouseBalances||[]).find(balance=>balance.warehouseId===row.warehouseId&&balance.itemId===row.itemId&&Number(balance.stock)>EPS);
    const quantity=first?Math.min(Number(first.stock),Number(row.remainingQuantity)):0;
    setAllocations(first&&quantity>EPS?[{lotId:first.lotId,quantity:String(quantity)}]:[]);
  }
  function addAllocation(){
    if(!selected)return;
    const used=new Set(allocations.map(row=>row.lotId));
    const next=eligibleBalances.find(row=>!used.has(row.lotId));
    if(!next)return;
    const quantity=Math.min(Number(next.stock),Math.max(0,selected.remainingQuantity-allocationTotal));
    setAllocations(current=>[...current,{lotId:next.lotId,quantity:quantity>EPS?String(quantity):""}]);
  }
  function updateAllocation(index:number,patch:Partial<Allocation>){setAllocations(current=>current.map((row,i)=>i===index?{...row,...patch}:row));}
  function removeAllocation(index:number){setAllocations(current=>current.filter((_,i)=>i!==index));}

  async function createDraft(event:React.FormEvent){
    event.preventDefault();
    if(!selected||!canCreate)return;
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/staff/material-consumption",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({reservationId:selected.reservationId,allocations:allocations.map(row=>({lotId:row.lotId,quantity:Number(row.quantity)}))}),
      });
      const payload=await response.json().catch(()=>({})) as CreatedPayload;
      if(!response.ok){setNotice(`⚠ ${payload.error||"Не вдалося створити чернетку списання"}`);return;}
      setNotice(`✓ Створено чернетку ${payload.document?.number||"списання"}. Проведіть її у складських документах після перевірки фактичних партій.`);
      setAllocations([]);
      await load();
    }catch(e){setNotice(`⚠ ${e instanceof Error?e.message:"Не вдалося створити чернетку списання"}`);}
    finally{setBusy(false);}
  }

  return <StaffWorkspaceShell active="inventory" title="Фактичне списання матеріалів" description="Завершена послуга → планова резервація → явний вибір фактичної партії → чернетка списання. Фізичний рух виникає лише після окремого проведення документа." staffName={inventory?.staff.displayName||inventory?.staff.email} staffRole={inventory?.staff.role}>
    {error&&<p className="financeError">{error}</p>}
    {!inventory&&!error&&<p className="financeLoading">Завантаження…</p>}
    {inventory&&<div className="inventoryDocumentsLayout">
      <section className="financeJournal">
        <header className="financeToolbar"><div className="financeTabs"><button type="button" onClick={()=>window.location.assign("/staff/inventory")}>← Складський облік</button><button type="button" onClick={()=>window.location.assign("/staff/inventory/transfers")}>Переміщення</button><button type="button" onClick={()=>window.location.assign("/staff/inventory/counts")}>Інвентаризація</button></div><button type="button" onClick={()=>void load()}>Оновити</button></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Виконання</th><th>Послуга</th><th>Матеріал</th><th>Склад</th><th>План</th><th>Чернетки</th><th>Проведено</th><th>Залишок</th><th>Стан</th><th/></tr></thead><tbody>
          {rows.map(row=><tr key={row.reservationId}><td><b>{row.bookingCode||`#${row.bookingId}`}</b><small>{fmtDate(row.performedAt)}</small></td><td><b>{row.serviceTitle||row.serviceCode}</b><small>{row.serviceCode}</small></td><td>{row.itemName}<small>{row.itemUnit}</small></td><td>{row.warehouseName}<small>{row.warehouseCode}</small></td><td>{fmt(row.plannedQuantity)}</td><td>{fmt(row.draftQuantity)}</td><td>{fmt(row.postedQuantity)}</td><td><b>{fmt(row.remainingQuantity)}</b></td><td><span className={`financeState state-${row.status}`}>{statusLabel(row.status)}</span></td><td><button type="button" disabled={row.remainingQuantity<=EPS} onClick={()=>choose(row)}>{row.remainingQuantity>EPS?"Розподілити":"Готово"}</button></td></tr>)}
          {rows.length===0&&<tr><td colSpan={10}>Немає завершених послуг із матеріалами, що очікують фактичного списання.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="inventoryDocumentCard">
        <header><div><small>Контрольоване виконання</small><h2>{selected?`${selected.bookingCode||`#${selected.bookingId}`} · ${selected.itemName}`:"Оберіть рядок черги"}</h2><p>{selected?`${selected.serviceTitle||selected.serviceCode} · ${selected.warehouseName}. До фактичного списання: ${fmt(selected.remainingQuantity)} ${selected.itemUnit}.`:"Планова норма не списує склад автоматично. Спочатку оберіть завершену послугу, потім конкретні фактичні партії."}</p></div></header>
        {notice&&<p className={notice.startsWith("⚠")?"financeError":"notice"}>{notice}</p>}
        {selected&&<form className="inventoryOperations" onSubmit={createDraft}><div>
          <p><b>План:</b> {fmt(selected.plannedQuantity)} {selected.itemUnit} · <b>у чернетках:</b> {fmt(selected.draftQuantity)} · <b>проведено:</b> {fmt(selected.postedQuantity)} · <b>ще потрібно:</b> {fmt(selected.remainingQuantity)}</p>
          {eligibleBalances.length===0&&<p className="financeError">На складі «{selected.warehouseName}» немає позитивного залишку цього матеріалу в жодній партії. Чернетку створити неможливо.</p>}
          {allocations.map((allocation,index)=>{const balance=balanceByLot.get(allocation.lotId);return <div key={`${index}-${allocation.lotId}`}>
            <label>Фактична партія<select value={allocation.lotId} onChange={e=>updateAllocation(index,{lotId:Number(e.target.value)})}>{eligibleBalances.map(row=><option key={row.lotId} value={row.lotId}>{row.lotNumber||`lot #${row.lotId}`} · доступно {fmt(row.stock)} {selected.itemUnit}</option>)}</select></label>
            <label>Кількість<input type="number" min="0.000001" step="any" required value={allocation.quantity} onChange={e=>updateAllocation(index,{quantity:e.target.value})}/>{balance&&<small>Залишок партії: {fmt(balance.stock)} {selected.itemUnit}</small>}</label>
            <button type="button" onClick={()=>removeAllocation(index)}>Прибрати партію</button>
          </div>;})}
          <div><button type="button" disabled={allocations.length>=eligibleBalances.length||unallocated<=EPS} onClick={addAllocation}>Додати партію</button></div>
          <p><b>Розподілено:</b> {fmt(allocationTotal)} {selected.itemUnit} · <b>нерозподілено:</b> {fmt(unallocated)} {selected.itemUnit}</p>
          {(hasInvalidAllocation||hasDuplicateLot||allocationTotal>selected.remainingQuantity+EPS)&&<p className="financeError">Перевірте партії та кількість: кожна партія має бути унікальною, кількість — додатною, не більшою за її поточний залишок, а загальна кількість — не більшою за залишок планової норми.</p>}
          {canManage&&<button className="primary" disabled={busy||!canCreate}>{busy?"Створення…":"Створити чернетку списання"}</button>}
          <p><small>Ця дія не проводить складський документ і не створює фізичний рух автоматично. Після створення перевірте чернетку у «Склад → Документи» та проведіть її окремо.</small></p>
        </div></form>}
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
