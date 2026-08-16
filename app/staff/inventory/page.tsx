"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Staff = { email:string; displayName:string; role:string };
type Item = { id:number; sku:string; name:string; category:string; unit:string; minStock:number; active:number; stock:number; expiringStock:number; nextExpiry:string };
type Supplier = { id:number; code:string; name:string };
type Warehouse = { id:number; code:string; name:string; active:number; isDefault:number };
type Lot = { id:number; itemId:number; itemName:string; lotNumber:string; expiresOn:string; supplier:string; supplierCounterpartyId:number|null; stock:number };
type WarehouseBalance = { warehouseId:number; warehouseCode:string; warehouseName:string; lotId:number; itemId:number; itemName:string; lotNumber:string; stock:number };
type Movement = { id:number; itemId:number; itemName:string; lotId:number; lotNumber:string; warehouseId:number|null; warehouseCode:string; warehouseName:string; movementType:string; quantityDelta:number; unit:string; reason:string; bookingId:number|null; actorEmail:string; createdAt:string; documentId:number|null };
type Payload = { items:Item[]; lots:Lot[]; warehouseBalances:WarehouseBalance[]; warehouses:Warehouse[]; movements:Movement[]; counterparties:Supplier[]; staff:Staff; canManage:boolean; error?:string };
type DocumentState = "draft"|"posted"|"reversed"|"cancelled";
type DocumentType = "inventory_receipt"|"inventory_writeoff";
type DocumentSummary = { id:number; documentType:DocumentType; number:string; occurredAt:string; state:DocumentState; comment:string; createdBy:string; createdAt:string; postedBy:string; postedAt:string; lineCount:number; totalQuantity:number };
type DocumentLine = { id:number; lineNo:number; itemId:number; lotId:number|null; warehouseId:number; warehouseCode:string; warehouseName:string; lotNumber:string; expiresOn:string; supplier:string; supplierCounterpartyId:number|null; quantity:number; reason:string; bookingId:number|null };
type DocumentDetail = { document:DocumentSummary; lines:DocumentLine[] };
type DocumentsPayload = { documents:DocumentSummary[]; staff:Staff; canManage:boolean; error?:string };
type Mode = "stock"|"documents"|"movements";

const CATEGORY_UK:Record<string,string> = {
  contrast:"Контраст", catheter:"Катетери", syringe:"Шприци", infusion:"Системи/інфузія",
  ppe:"Засоби захисту", film:"Плівка", paper:"Папір", disinfectant:"Дезінфекція", other:"Інше",
};
const CATEGORY_OPTIONS = Object.entries(CATEGORY_UK);
const STATE_UK:Record<DocumentState,string> = { draft:"Чернетка",posted:"Проведено",reversed:"Сторновано",cancelled:"Скасовано" };
const TYPE_UK:Record<DocumentType,string> = { inventory_receipt:"Надходження матеріалів",inventory_writeoff:"Списання матеріалів" };
function fmt(n:number) { return Number(n || 0).toLocaleString("uk-UA", { maximumFractionDigits:2 }); }
function fmtDate(value:string) { const d=new Date(value); return Number.isNaN(d.getTime())?value:d.toLocaleString("uk-UA",{dateStyle:"short",timeStyle:"short"}); }

export default function InventoryPage() {
  const [data,setData] = useState<Payload|null>(null);
  const [documents,setDocuments] = useState<DocumentSummary[]>([]);
  const [selected,setSelected] = useState<DocumentDetail|null>(null);
  const [loaded,setLoaded] = useState(false);
  const [error,setError] = useState("");
  const [toast,setToast] = useState("");
  const [mode,setMode] = useState<Mode>("stock");
  const [query,setQuery] = useState("");
  const [category,setCategory] = useState("all");
  const [showOnlyAlert,setShowOnlyAlert] = useState(false);
  const [busy,setBusy] = useState(false);
  const [itemForm,setItemForm] = useState({ name:"", sku:"", category:"contrast", unit:"шт", minStock:"0" });
  const [receive,setReceive] = useState({ warehouseId:"", itemId:"", quantity:"", lotNumber:"", expiresOn:"", supplierCounterpartyId:"", reason:"Надходження" });
  const [writeoff,setWriteoff] = useState({ warehouseId:"", lotId:"", quantity:"", reason:"Використано під час дослідження", bookingId:"" });

  async function loadInventory() {
    const res = await fetch("/api/staff/inventory", { cache:"no-store" });
    const payload = await res.json().catch(()=>({})) as Payload;
    if (!res.ok || !payload.staff) throw new Error(payload.error || "Не вдалося завантажити склад");
    setData(payload);
    const defaultWarehouse=payload.warehouses?.find(w=>w.active&&w.isDefault) || payload.warehouses?.find(w=>w.active);
    if(defaultWarehouse){
      setReceive(current=>current.warehouseId?current:{...current,warehouseId:String(defaultWarehouse.id)});
      setWriteoff(current=>current.warehouseId?current:{...current,warehouseId:String(defaultWarehouse.id)});
    }
  }
  async function loadDocuments() {
    const res=await fetch("/api/staff/inventory/documents",{cache:"no-store"});
    const payload=await res.json().catch(()=>({})) as DocumentsPayload;
    if(!res.ok) throw new Error(payload.error || "Не вдалося завантажити документи");
    setDocuments(payload.documents || []);
  }
  async function load() {
    try { await Promise.all([loadInventory(),loadDocuments()]); setError(""); }
    catch(e) { setError(e instanceof Error?e.message:"Не вдалося завантажити склад"); }
    finally { setLoaded(true); }
  }
  useEffect(()=>{ const t=window.setTimeout(()=>void load(),0); return ()=>window.clearTimeout(t); },[]);

  const items = useMemo(() => {
    const q=query.trim().toLowerCase();
    return (data?.items || []).filter(i => {
      if (category !== "all" && i.category !== category) return false;
      if (showOnlyAlert && !(i.stock <= i.minStock || i.expiringStock > 0)) return false;
      return !q || `${i.name} ${i.sku}`.toLowerCase().includes(q);
    });
  },[data,query,category,showOnlyAlert]);

  const itemMap=useMemo(()=>new Map((data?.items||[]).map(i=>[i.id,i])),[data]);
  const writeoffLots=useMemo(()=>{
    const warehouseId=Number(writeoff.warehouseId);
    return (data?.warehouseBalances||[]).filter(row=>row.warehouseId===warehouseId&&row.stock>0.000001);
  },[data,writeoff.warehouseId]);
  const metrics = useMemo(() => {
    const all=(data?.items || []).filter(i=>i.active);
    return { active:all.length, low:all.filter(i=>i.stock <= i.minStock).length, expiring:all.filter(i=>i.expiringStock > 0).length, empty:all.filter(i=>i.stock <= 0).length };
  },[data]);

  async function postInventory(body:Record<string,unknown>,ok:string) {
    setBusy(true); setToast("");
    try {
      const res=await fetch("/api/staff/inventory", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body) });
      const p=await res.json().catch(()=>({})) as {error?:string};
      if(!res.ok){ setToast(`⚠ ${p.error || "Помилка операції"}`); return false; }
      setToast(`✓ ${ok}`); await loadInventory(); return true;
    } finally { setBusy(false); }
  }

  async function documentAction(body:Record<string,unknown>,ok:string) {
    setBusy(true); setToast("");
    try {
      const res=await fetch("/api/staff/inventory/documents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const payload=await res.json().catch(()=>({})) as DocumentDetail&{error?:string};
      if(!res.ok){setToast(`⚠ ${payload.error || "Помилка документа"}`);return null;}
      setToast(`✓ ${ok}`);
      await Promise.all([loadInventory(),loadDocuments()]);
      if(payload.document) setSelected(payload);
      return payload;
    } finally {setBusy(false);}
  }

  async function openDocument(id:number) {
    setBusy(true);
    try {
      const res=await fetch(`/api/staff/inventory/documents?id=${id}`,{cache:"no-store"});
      const p=await res.json().catch(()=>({})) as DocumentDetail&{error?:string};
      if(!res.ok){setToast(`⚠ ${p.error||"Документ не знайдено"}`);return;}
      setSelected(p);setMode("documents");
    } finally {setBusy(false);}
  }

  async function createItem(e:React.FormEvent) {
    e.preventDefault();
    const ok=await postInventory({ action:"create_item", ...itemForm, minStock:Number(itemForm.minStock) },"Матеріал додано");
    if(ok) setItemForm({ name:"", sku:"", category:"contrast", unit:"шт", minStock:"0" });
  }
  async function createReceiptDraft(e:React.FormEvent) {
    e.preventDefault();
    const created=await documentAction({
      action:"create",documentType:"inventory_receipt",
      lines:[{warehouseId:Number(receive.warehouseId),itemId:Number(receive.itemId),quantity:Number(receive.quantity),lotNumber:receive.lotNumber,expiresOn:receive.expiresOn,supplierCounterpartyId:receive.supplierCounterpartyId?Number(receive.supplierCounterpartyId):null,reason:receive.reason}],
    },"Чернетку надходження створено");
    if(created){setReceive({...receive,quantity:"",lotNumber:"",expiresOn:"",supplierCounterpartyId:"",reason:"Надходження"});setMode("documents");}
  }
  async function createWriteoffDraft(e:React.FormEvent) {
    e.preventDefault();
    const created=await documentAction({
      action:"create",documentType:"inventory_writeoff",
      lines:[{warehouseId:Number(writeoff.warehouseId),lotId:Number(writeoff.lotId),quantity:Number(writeoff.quantity),reason:writeoff.reason,bookingId:writeoff.bookingId?Number(writeoff.bookingId):null}],
    },"Чернетку списання створено");
    if(created){setWriteoff({...writeoff,lotId:"",quantity:"",reason:"Використано під час дослідження",bookingId:""});setMode("documents");}
  }

  return <StaffWorkspaceShell active="inventory" title="Склад" description="BAS-подібний облік матеріалів: номенклатура, склади, документи, проведення, регістр рухів і друковані форми." staffName={data?.staff.displayName || data?.staff.email} staffRole={data?.staff.role}>
    {!loaded ? <p className="notice">Завантаження складу…</p> : error ? <p className="notice error">{error}</p> : data && <>
      {toast && <p className={`inventoryToast${toast.startsWith("⚠")?" warn":""}`} role="status" onClick={()=>setToast("")}>{toast}</p>}
      <section className="inventoryKpi" aria-label="Стан складу"><div><b>{metrics.active}</b><span>позицій активно</span></div><div className={metrics.low?"warn":""}><b>{metrics.low}</b><span>нижче мінімуму</span></div><div className={metrics.expiring?"warn":""}><b>{metrics.expiring}</b><span>термін ≤ 30 днів</span></div><div className={metrics.empty?"danger":""}><b>{metrics.empty}</b><span>немає залишку</span></div></section>
      <div className="inventoryTabs" role="tablist">
        <button className={mode==="stock"?"active":""} onClick={()=>setMode("stock")}>Залишки</button>
        <button className={mode==="documents"?"active":""} onClick={()=>setMode("documents")}>Документи <span className="inventoryTabCount">{documents.length}</span></button>
        <button className={mode==="movements"?"active":""} onClick={()=>setMode("movements")}>Рухи</button>
        <button onClick={()=>window.location.assign("/staff/warehouses")}>Склади</button>
      </div>

      {mode === "stock" && <>
        <section className="inventoryToolbar"><input type="search" placeholder="Пошук за назвою або кодом" value={query} onChange={e=>setQuery(e.target.value)} /><select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">Усі категорії</option>{CATEGORY_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><label><input type="checkbox" checked={showOnlyAlert} onChange={e=>setShowOnlyAlert(e.target.checked)} /> Лише потребують уваги</label></section>
        <div className="inventoryGrid">
          <section className="inventoryMainTable"><div className="inventorySectionHead"><h2>Номенклатура</h2><span>{items.length}</span></div><div className="inventoryTableWrap"><table><thead><tr><th>Матеріал</th><th>Категорія</th><th>Залишок</th><th>Мін.</th><th>Найбл. термін</th><th>Стан</th></tr></thead><tbody>
            {items.map(i=>{ const low=i.stock<=i.minStock; const exp=i.expiringStock>0; return <tr key={i.id} className={`${!i.active?"inactive ":""}${low?"low":""}`}><td><b>{i.name}</b><small>{i.sku || "без коду"} · {i.unit}</small></td><td>{CATEGORY_UK[i.category] || i.category}</td><td className="num"><strong>{fmt(i.stock)}</strong> {i.unit}</td><td className="num">{fmt(i.minStock)}</td><td>{i.nextExpiry || "—"}{exp?<small className="expiryWarn"> ≤ 30 днів</small>:null}</td><td><span className={`inventoryState ${i.stock<=0?"empty":low?"low":"ok"}`}>{i.stock<=0?"Немає":low?"Поповнити":"Достатньо"}</span></td></tr>;})}
            {items.length===0 && <tr><td colSpan={6} className="emptyCell">Немає позицій за фільтром.</td></tr>}
          </tbody></table></div></section>
          <aside className="inventorySide"><section><div className="inventorySectionHead"><h2>Залишки по складах</h2><span>{data.warehouseBalances.length}</span></div><ul className="inventoryLots">{data.warehouseBalances.map(l=><li key={`${l.warehouseId}-${l.lotId}`}><div><b>{l.itemName}</b><small>{l.warehouseName} · партія {l.lotNumber || "—"}</small></div><span><b>{fmt(l.stock)}</b></span></li>)}{data.warehouseBalances.length===0 && <li className="inventoryEmpty">Залишків немає.</li>}</ul></section></aside>
        </div>

        {data.canManage && <section className="inventoryOperations">
          <form onSubmit={createItem}><h3>Нова номенклатура</h3><p className="inventoryFormHint">Довідник матеріалів</p><input required placeholder="Назва матеріалу" value={itemForm.name} onChange={e=>setItemForm({...itemForm,name:e.target.value})}/><input placeholder="Код / SKU" value={itemForm.sku} onChange={e=>setItemForm({...itemForm,sku:e.target.value})}/><select value={itemForm.category} onChange={e=>setItemForm({...itemForm,category:e.target.value})}>{CATEGORY_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><div className="inventoryFormRow"><input required placeholder="Одиниця" value={itemForm.unit} onChange={e=>setItemForm({...itemForm,unit:e.target.value})}/><input required type="number" min="0" step="0.01" placeholder="Мін. запас" value={itemForm.minStock} onChange={e=>setItemForm({...itemForm,minStock:e.target.value})}/></div><button disabled={busy}>Записати</button></form>
          <form onSubmit={createReceiptDraft}><h3>Надходження матеріалів</h3><p className="inventoryFormHint">Створює документ-чернетку. Залишок зміниться лише після «Провести».</p><select required value={receive.warehouseId} onChange={e=>setReceive({...receive,warehouseId:e.target.value})}><option value="">Оберіть склад</option>{data.warehouses.filter(w=>w.active).map(w=><option key={w.id} value={w.id}>{w.name}{w.code?` · ${w.code}`:""}{w.isDefault?" · основний":""}</option>)}</select><select required value={receive.itemId} onChange={e=>setReceive({...receive,itemId:e.target.value})}><option value="">Оберіть матеріал</option>{data.items.filter(i=>i.active).map(i=><option key={i.id} value={i.id}>{i.name} · {i.unit}</option>)}</select><div className="inventoryFormRow"><input required type="number" min="0.01" step="0.01" placeholder="Кількість" value={receive.quantity} onChange={e=>setReceive({...receive,quantity:e.target.value})}/><input placeholder="№ партії" value={receive.lotNumber} onChange={e=>setReceive({...receive,lotNumber:e.target.value})}/></div><input type="date" value={receive.expiresOn} onChange={e=>setReceive({...receive,expiresOn:e.target.value})}/><select value={receive.supplierCounterpartyId} onChange={e=>setReceive({...receive,supplierCounterpartyId:e.target.value})}><option value="">Без постачальника</option>{data.counterparties.map(c=><option key={c.id} value={c.id}>{c.name}{c.code?` · ${c.code}`:""}</option>)}</select><button type="button" className="inventorySmallBtn" onClick={()=>window.location.assign("/staff/counterparties")}>Контрагенти ↗</button><input placeholder="Примітка" value={receive.reason} onChange={e=>setReceive({...receive,reason:e.target.value})}/><button disabled={busy}>Створити чернетку</button></form>
          <form onSubmit={createWriteoffDraft}><h3>Списання матеріалів</h3><p className="inventoryFormHint">Партії показані лише з залишком на вибраному складі.</p><select required value={writeoff.warehouseId} onChange={e=>setWriteoff({...writeoff,warehouseId:e.target.value,lotId:""})}><option value="">Оберіть склад</option>{data.warehouses.filter(w=>w.active).map(w=><option key={w.id} value={w.id}>{w.name}{w.code?` · ${w.code}`:""}{w.isDefault?" · основний":""}</option>)}</select><select required value={writeoff.lotId} onChange={e=>setWriteoff({...writeoff,lotId:e.target.value})}><option value="">Оберіть партію</option>{writeoffLots.map(l=><option key={`${l.warehouseId}-${l.lotId}`} value={l.lotId}>{l.itemName} · {l.lotNumber || "без №"} · залишок {fmt(l.stock)}</option>)}</select><input required type="number" min="0.01" step="0.01" placeholder="Кількість" value={writeoff.quantity} onChange={e=>setWriteoff({...writeoff,quantity:e.target.value})}/><input required placeholder="Причина списання" value={writeoff.reason} onChange={e=>setWriteoff({...writeoff,reason:e.target.value})}/><input type="number" min="1" placeholder="ID дослідження (необов'язково)" value={writeoff.bookingId} onChange={e=>setWriteoff({...writeoff,bookingId:e.target.value})}/><button className="danger" disabled={busy}>Створити чернетку</button></form>
        </section>}
      </>}

      {mode === "documents" && <div className="inventoryDocumentsLayout">
        <section className="inventoryMainTable documents"><div className="inventorySectionHead"><h2>Журнал складських документів</h2><span>{documents.length}</span></div><div className="inventoryTableWrap"><table><thead><tr><th>Дата</th><th>Номер</th><th>Документ</th><th>Стан</th><th>Рядків</th><th>Кількість</th><th>Автор</th><th></th></tr></thead><tbody>
          {documents.map(d=><tr key={d.id} className={selected?.document.id===d.id?"selectedDoc":""}><td>{fmtDate(d.occurredAt)}</td><td><button className="inventoryDocLink" onClick={()=>void openDocument(d.id)}>{d.number}</button></td><td>{TYPE_UK[d.documentType]}</td><td><span className={`inventoryDocState ${d.state}`}>{STATE_UK[d.state]}</span></td><td className="num">{d.lineCount}</td><td className="num">{fmt(d.totalQuantity)}</td><td>{d.createdBy}</td><td><button className="inventorySmallBtn" onClick={()=>void openDocument(d.id)}>Відкрити</button></td></tr>)}
          {documents.length===0&&<tr><td colSpan={8} className="emptyCell">Складських документів ще немає.</td></tr>}
        </tbody></table></div></section>

        {selected&&<section className="inventoryDocumentCard">
          <header><div><small>{TYPE_UK[selected.document.documentType]}</small><h2>{selected.document.number}</h2><p>{fmtDate(selected.document.occurredAt)} · {selected.document.createdBy}</p></div><span className={`inventoryDocState ${selected.document.state}`}>{STATE_UK[selected.document.state]}</span></header>
          {selected.document.comment&&<p className="inventoryDocComment">{selected.document.comment}</p>}
          <div className="inventoryDocLines"><table><thead><tr><th>№</th><th>Склад</th><th>Матеріал</th><th>Партія</th><th>Кількість</th><th>Підстава</th></tr></thead><tbody>{selected.lines.map(line=>{const i=itemMap.get(line.itemId);return <tr key={line.id}><td>{line.lineNo}</td><td><b>{line.warehouseName}</b><small>{line.warehouseCode||`#${line.warehouseId}`}</small></td><td><b>{i?.name||`Матеріал #${line.itemId}`}</b><small>{i?.unit||""}</small></td><td>{line.lotNumber||"—"}{line.expiresOn?<small>до {line.expiresOn}</small>:null}{line.supplier?<small>постачальник: {line.supplier}</small>:null}</td><td className="num">{fmt(line.quantity)} {i?.unit||""}</td><td>{line.reason}{line.bookingId?<small>дослідження #{line.bookingId}</small>:null}</td></tr>;})}</tbody></table></div>
          <footer>
            {selected.document.state==="draft"&&data.canManage&&<><button className="primary" disabled={busy} onClick={()=>void documentAction({action:"post",documentId:selected.document.id},"Документ проведено")}>Провести</button><button disabled={busy} onClick={()=>void documentAction({action:"cancel",documentId:selected.document.id},"Чернетку скасовано")}>Скасувати</button></>}
            <button onClick={()=>window.open(`/staff/inventory/print?id=${selected.document.id}`,"_blank","noopener,noreferrer")}>Друк</button>
            {selected.document.state==="posted"&&<span className="inventoryPostedMeta">Провів: {selected.document.postedBy} · {fmtDate(selected.document.postedAt)}</span>}
          </footer>
        </section>}
      </div>}

      {mode === "movements" && <section className="inventoryMainTable movements"><div className="inventorySectionHead"><h2>Регістр рухів запасів</h2><span>останні {data.movements.length}</span></div><div className="inventoryTableWrap"><table><thead><tr><th>Дата</th><th>Склад</th><th>Матеріал / партія</th><th>Операція</th><th>Кількість</th><th>Документ</th><th>Причина</th><th>Хто</th></tr></thead><tbody>{data.movements.map(m=><tr key={m.id}><td>{m.createdAt}</td><td>{m.warehouseName||"Legacy"}<small>{m.warehouseCode}</small></td><td><b>{m.itemName}</b><small>{m.lotNumber || "без №"}</small></td><td>{m.movementType==="receipt"?"Надходження":"Списання"}</td><td className={`num ${m.quantityDelta<0?"negative":"positive"}`}>{m.quantityDelta>0?"+":""}{fmt(m.quantityDelta)} {m.unit}</td><td>{m.documentId?<button className="inventoryDocLink" onClick={()=>void openDocument(m.documentId!)}>#{m.documentId}</button>:<span className="legacyMovement">Legacy</span>}</td><td>{m.reason}{m.bookingId?<small>дослідження #{m.bookingId}</small>:null}</td><td>{m.actorEmail}</td></tr>)}</tbody></table></div></section>}
    </>}
  </StaffWorkspaceShell>;
}
