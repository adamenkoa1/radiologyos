"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Staff = { email:string; displayName:string; role:string };
type Item = { id:number; sku:string; name:string; category:string; unit:string; minStock:number; active:number; stock:number; expiringStock:number; nextExpiry:string };
type Lot = { id:number; itemId:number; itemName:string; lotNumber:string; expiresOn:string; supplier:string; stock:number };
type Movement = { id:number; itemId:number; itemName:string; lotId:number; lotNumber:string; movementType:string; quantityDelta:number; unit:string; reason:string; bookingId:number|null; actorEmail:string; createdAt:string };
type Payload = { items:Item[]; lots:Lot[]; movements:Movement[]; staff:Staff; canManage:boolean; error?:string };

type Mode = "stock"|"movements";
const CATEGORY_UK:Record<string,string> = {
  contrast:"Контраст", catheter:"Катетери", syringe:"Шприци", infusion:"Системи/інфузія",
  ppe:"Засоби захисту", film:"Плівка", paper:"Папір", disinfectant:"Дезінфекція", other:"Інше",
};
const CATEGORY_OPTIONS = Object.entries(CATEGORY_UK);
function fmt(n:number) { return Number(n || 0).toLocaleString("uk-UA", { maximumFractionDigits:2 }); }
function todayKyiv() { return new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Kyiv" }).format(new Date()); }

export default function InventoryPage() {
  const [data,setData] = useState<Payload|null>(null);
  const [loaded,setLoaded] = useState(false);
  const [error,setError] = useState("");
  const [toast,setToast] = useState("");
  const [mode,setMode] = useState<Mode>("stock");
  const [query,setQuery] = useState("");
  const [category,setCategory] = useState("all");
  const [showOnlyAlert,setShowOnlyAlert] = useState(false);
  const [busy,setBusy] = useState(false);
  const [itemForm,setItemForm] = useState({ name:"", sku:"", category:"contrast", unit:"шт", minStock:"0" });
  const [receive,setReceive] = useState({ itemId:"", quantity:"", lotNumber:"", expiresOn:"", supplier:"", reason:"Надходження" });
  const [writeoff,setWriteoff] = useState({ lotId:"", quantity:"", reason:"Використано під час дослідження", bookingId:"" });

  async function load() {
    const res = await fetch("/api/staff/inventory", { cache:"no-store" });
    const payload = await res.json().catch(()=>({})) as Payload;
    if (!res.ok || !payload.staff) { setError(payload.error || "Не вдалося завантажити склад"); setLoaded(true); return; }
    setData(payload); setLoaded(true); setError("");
  }
  useEffect(()=>{ const t=window.setTimeout(()=>void load(),0); return ()=>window.clearTimeout(t); },[]);

  const items = useMemo(() => {
    const q=query.trim().toLowerCase();
    return (data?.items || []).filter(i => {
      if (category !== "all" && i.category !== category) return false;
      if (showOnlyAlert && !(i.stock <= i.minStock || i.expiringStock > 0)) return false;
      if (q && !`${i.name} ${i.sku}`.toLowerCase().includes(q)) return false;
      return true;
    });
  },[data,query,category,showOnlyAlert]);

  const metrics = useMemo(() => {
    const all=(data?.items || []).filter(i=>i.active);
    return {
      active:all.length,
      low:all.filter(i=>i.stock <= i.minStock).length,
      expiring:all.filter(i=>i.expiringStock > 0).length,
      empty:all.filter(i=>i.stock <= 0).length,
    };
  },[data]);

  async function post(body:Record<string,unknown>,ok:string) {
    setBusy(true); setToast("");
    try {
      const res=await fetch("/api/staff/inventory", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body) });
      const p=await res.json().catch(()=>({})) as {error?:string};
      if(!res.ok){ setToast(`⚠ ${p.error || "Помилка операції"}`); return false; }
      setToast(`✓ ${ok}`); await load(); return true;
    } finally { setBusy(false); }
  }

  async function createItem(e:React.FormEvent) {
    e.preventDefault();
    const ok=await post({ action:"create_item", ...itemForm, minStock:Number(itemForm.minStock) },"Матеріал додано");
    if(ok) setItemForm({ name:"", sku:"", category:"contrast", unit:"шт", minStock:"0" });
  }
  async function receiveStock(e:React.FormEvent) {
    e.preventDefault();
    const ok=await post({ action:"receive", itemId:Number(receive.itemId), quantity:Number(receive.quantity), lotNumber:receive.lotNumber, expiresOn:receive.expiresOn, supplier:receive.supplier, reason:receive.reason },"Надходження проведено");
    if(ok) setReceive({ itemId:receive.itemId, quantity:"", lotNumber:"", expiresOn:"", supplier:"", reason:"Надходження" });
  }
  async function writeOff(e:React.FormEvent) {
    e.preventDefault();
    const ok=await post({ action:"writeoff", lotId:Number(writeoff.lotId), quantity:Number(writeoff.quantity), reason:writeoff.reason, bookingId:writeoff.bookingId ? Number(writeoff.bookingId) : null },"Списання проведено");
    if(ok) setWriteoff({ lotId:writeoff.lotId, quantity:"", reason:"Використано під час дослідження", bookingId:"" });
  }

  const today=todayKyiv();
  return <StaffWorkspaceShell
    active="inventory"
    title="Витратні матеріали / склад"
    description="Залишки, партії, терміни придатності та контроль руху матеріалів відділення."
    staffName={data?.staff.displayName || data?.staff.email}
    staffRole={data?.staff.role}
  >
    {!loaded ? <p className="notice">Завантаження складу…</p> : error ? <p className="notice error">{error}</p> : data && <>
      {toast && <p className={`inventoryToast${toast.startsWith("⚠")?" warn":""}`} role="status" onClick={()=>setToast("")}>{toast}</p>}
      <section className="inventoryKpi" aria-label="Стан складу">
        <div><b>{metrics.active}</b><span>позицій активно</span></div>
        <div className={metrics.low?"warn":""}><b>{metrics.low}</b><span>нижче мінімуму</span></div>
        <div className={metrics.expiring?"warn":""}><b>{metrics.expiring}</b><span>термін ≤ 30 днів</span></div>
        <div className={metrics.empty?"danger":""}><b>{metrics.empty}</b><span>немає залишку</span></div>
      </section>

      <div className="inventoryTabs" role="tablist">
        <button className={mode==="stock"?"active":""} onClick={()=>setMode("stock")}>Залишки й партії</button>
        <button className={mode==="movements"?"active":""} onClick={()=>setMode("movements")}>Журнал рухів</button>
      </div>

      {mode === "stock" && <>
        <section className="inventoryToolbar">
          <input type="search" placeholder="Пошук за назвою або кодом" value={query} onChange={e=>setQuery(e.target.value)} />
          <select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">Усі категорії</option>{CATEGORY_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
          <label><input type="checkbox" checked={showOnlyAlert} onChange={e=>setShowOnlyAlert(e.target.checked)} /> Лише потребують уваги</label>
        </section>

        <div className="inventoryGrid">
          <section className="inventoryMainTable">
            <div className="inventorySectionHead"><h2>Номенклатура</h2><span>{items.length}</span></div>
            <div className="inventoryTableWrap"><table><thead><tr><th>Матеріал</th><th>Категорія</th><th>Залишок</th><th>Мін.</th><th>Найбл. термін</th><th>Стан</th></tr></thead><tbody>
              {items.map(i=>{ const low=i.stock<=i.minStock; const exp=!!i.nextExpiry && i.nextExpiry<=new Date(Date.now()+30*86400000).toISOString().slice(0,10); return <tr key={i.id} className={`${!i.active?"inactive ":""}${low?"low":""}`}>
                <td><b>{i.name}</b><small>{i.sku || "без коду"} · {i.unit}</small></td>
                <td>{CATEGORY_UK[i.category] || i.category}</td>
                <td className="num"><strong>{fmt(i.stock)}</strong> {i.unit}</td>
                <td className="num">{fmt(i.minStock)}</td>
                <td>{i.nextExpiry || "—"}{exp?<small className="expiryWarn"> скоро</small>:null}</td>
                <td><span className={`inventoryState ${i.stock<=0?"empty":low?"low":"ok"}`}>{i.stock<=0?"Немає":low?"Поповнити":"Достатньо"}</span></td>
              </tr>;})}
              {items.length===0 && <tr><td colSpan={6} className="emptyCell">Немає позицій за фільтром.</td></tr>}
            </tbody></table></div>
          </section>

          <aside className="inventorySide">
            <section><div className="inventorySectionHead"><h2>Партії в наявності</h2><span>{data.lots.length}</span></div><ul className="inventoryLots">
              {data.lots.map(l=><li key={l.id} className={l.expiresOn && l.expiresOn < today ? "expired":""}><div><b>{l.itemName}</b><small>Партія {l.lotNumber || "—"}{l.supplier?` · ${l.supplier}`:""}</small></div><span><b>{fmt(l.stock)}</b><small>{l.expiresOn?`до ${l.expiresOn}`:"без терміну"}</small></span></li>)}
              {data.lots.length===0 && <li className="inventoryEmpty">Партій із залишком немає.</li>}
            </ul></section>
          </aside>
        </div>

        {data.canManage && <section className="inventoryOperations">
          <form onSubmit={createItem}><h3>Нова позиція</h3><input required placeholder="Назва матеріалу" value={itemForm.name} onChange={e=>setItemForm({...itemForm,name:e.target.value})}/><input placeholder="Код / SKU" value={itemForm.sku} onChange={e=>setItemForm({...itemForm,sku:e.target.value})}/><select value={itemForm.category} onChange={e=>setItemForm({...itemForm,category:e.target.value})}>{CATEGORY_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><div className="inventoryFormRow"><input required placeholder="Одиниця" value={itemForm.unit} onChange={e=>setItemForm({...itemForm,unit:e.target.value})}/><input required type="number" min="0" step="0.01" placeholder="Мін. запас" value={itemForm.minStock} onChange={e=>setItemForm({...itemForm,minStock:e.target.value})}/></div><button disabled={busy}>Додати позицію</button></form>
          <form onSubmit={receiveStock}><h3>Прихід</h3><select required value={receive.itemId} onChange={e=>setReceive({...receive,itemId:e.target.value})}><option value="">Оберіть матеріал</option>{data.items.filter(i=>i.active).map(i=><option key={i.id} value={i.id}>{i.name} · {i.unit}</option>)}</select><div className="inventoryFormRow"><input required type="number" min="0.01" step="0.01" placeholder="Кількість" value={receive.quantity} onChange={e=>setReceive({...receive,quantity:e.target.value})}/><input placeholder="№ партії" value={receive.lotNumber} onChange={e=>setReceive({...receive,lotNumber:e.target.value})}/></div><input type="date" value={receive.expiresOn} onChange={e=>setReceive({...receive,expiresOn:e.target.value})}/><input placeholder="Постачальник" value={receive.supplier} onChange={e=>setReceive({...receive,supplier:e.target.value})}/><input placeholder="Примітка" value={receive.reason} onChange={e=>setReceive({...receive,reason:e.target.value})}/><button disabled={busy}>Провести прихід</button></form>
          <form onSubmit={writeOff}><h3>Списання</h3><select required value={writeoff.lotId} onChange={e=>setWriteoff({...writeoff,lotId:e.target.value})}><option value="">Оберіть партію</option>{data.lots.map(l=><option key={l.id} value={l.id}>{l.itemName} · {l.lotNumber || "без №"} · залишок {fmt(l.stock)}</option>)}</select><input required type="number" min="0.01" step="0.01" placeholder="Кількість" value={writeoff.quantity} onChange={e=>setWriteoff({...writeoff,quantity:e.target.value})}/><input required placeholder="Причина списання" value={writeoff.reason} onChange={e=>setWriteoff({...writeoff,reason:e.target.value})}/><input type="number" min="1" placeholder="ID дослідження (необов'язково)" value={writeoff.bookingId} onChange={e=>setWriteoff({...writeoff,bookingId:e.target.value})}/><button className="danger" disabled={busy}>Списати</button></form>
        </section>}
      </>}

      {mode === "movements" && <section className="inventoryMainTable movements"><div className="inventorySectionHead"><h2>Журнал рухів</h2><span>останні {data.movements.length}</span></div><div className="inventoryTableWrap"><table><thead><tr><th>Дата</th><th>Матеріал / партія</th><th>Операція</th><th>Кількість</th><th>Причина</th><th>Хто</th></tr></thead><tbody>{data.movements.map(m=><tr key={m.id}><td>{m.createdAt}</td><td><b>{m.itemName}</b><small>{m.lotNumber || "без №"}</small></td><td>{m.movementType==="receipt"?"Прихід":"Списання"}</td><td className={`num ${m.quantityDelta<0?"negative":"positive"}`}>{m.quantityDelta>0?"+":""}{fmt(m.quantityDelta)} {m.unit}</td><td>{m.reason}{m.bookingId?<small>дослідження #{m.bookingId}</small>:null}</td><td>{m.actorEmail}</td></tr>)}</tbody></table></div></section>}
    </>}
  </StaffWorkspaceShell>;
}
