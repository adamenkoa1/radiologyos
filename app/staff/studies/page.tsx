"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import StudyContextDrawer from "./study-context-drawer";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };
type Option = { v:string; l:string };
type Study = {
  id:number; code:string; name:string; service:string; equipmentId:string;
  desiredDate:string; desiredTime:string; status:string; stateLabel:string;
  terminal:boolean; performedAt:string; protocolStatus:string;
  studyStatus:string|null; accessionNumber:string|null; nextStates:Option[];
  assignedRadiologistEmail:string; assignedRadiographerEmail:string;
  radiologistName:string; radiographerName:string;
};
type StateInfo = { v:string; l:string; count:number };
type Data = {
  organization:{ id:number; name:string; slug:string };
  role:StaffRole; canManage:boolean; states:StateInfo[]; studies:Study[];
  radiologists:Option[]; radiographers:Option[];
  profile:{ type:string; label:string };
  features:{ dicomPacs:boolean };
};
type SavedView = { id:number; name:string; config:{ filter:string; equipment:string } };
type PendingDelivery = {
  kind:"protocol"|"addendum"; bookingId:number; bookingCode:string; patientName:string;
  serviceTitle:string; documentNumber:string; version:number; signedBy:string; signedAt:string;
  addendumId:string; baseProtocolVersion:number;
};

const roleLabels: Record<StaffRole,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};
const equipmentNames: Record<string,string> = { ct:"КТ", xray:"Рентген", fluoro:"Флюорограф" };

const STATE_GROUP: Record<string,"intake"|"active"|"reporting"|"done"|"stopped"> = {
  new:"intake", requested:"intake", needs_verification:"intake", scheduled:"intake",
  confirmed:"intake", rescheduled:"intake",
  arrived:"active", queued:"active", in_progress:"active", performed:"active", images_ready:"active",
  reporting:"reporting", protocol_ready:"reporting", issued:"reporting",
  completed:"done",
  cancelled:"stopped", no_show:"stopped",
};

export default function StudiesPage() {
  const [data,setData] = useState<Data|null>(null);
  const [staff,setStaff] = useState<StaffInfo|null>(null);
  const [error,setError] = useState("");
  const [filter,setFilter] = useState("all");
  const [equipment,setEquipment] = useState("all");
  const [query,setQuery] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(0);
  const [savedViews,setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId,setSelectedViewId] = useState(0);
  const [viewName,setViewName] = useState("");
  const [viewBusy,setViewBusy] = useState(false);
  const [contextStudy,setContextStudy] = useState<Study|null>(null);
  const [pendingDeliveries,setPendingDeliveries] = useState<PendingDelivery[]>([]);
  const [deliveryBusy,setDeliveryBusy] = useState("");

  async function load() {
    const [response,deliveryResponse] = await Promise.all([
      fetch("/api/staff/studies", { cache:"no-store" }),
      fetch("/api/staff/result-deliveries", { cache:"no-store" }),
    ]);
    const payload = await response.json() as Data & { error?:string };
    if (!response.ok) { setError(payload.error || "Немає доступу"); return; }
    setData(payload);
    setStaff({ email:"", displayName:"", role:payload.role });
    if (deliveryResponse.ok) {
      const deliveries = await deliveryResponse.json() as { pending?:PendingDelivery[] };
      setPendingDeliveries(deliveries.pending || []);
    } else {
      setPendingDeliveries([]);
    }
    setError("");
  }

  async function loadSavedViews() {
    const response = await fetch("/api/staff/saved-views?surface=studies", { cache:"no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { views?:SavedView[] };
    setSavedViews(payload.views || []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); void loadSavedViews(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function deliverResult(item:PendingDelivery) {
    const key=item.kind === "protocol" ? `protocol:${item.bookingId}` : `addendum:${item.addendumId}`;
    setDeliveryBusy(key); setNotice("");
    try {
      const body=item.kind === "protocol"
        ? {kind:item.kind,bookingId:item.bookingId,version:item.version}
        : {kind:item.kind,addendumId:item.addendumId,version:item.version};
      const response=await fetch("/api/staff/result-deliveries",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setNotice(payload.error||"Не вдалося видати результат");return;}
      setNotice(item.kind === "protocol" ? "Протокол видано пацієнту." : "Виправлення до протоколу видано пацієнту.");
      await load();
    } catch {
      setNotice("Помилка мережі — не вдалося видати результат");
    } finally {
      setDeliveryBusy("");
    }
  }

  async function transition(id:number, status:string) {
    if (!status) return;
    setBusy(id); setNotice("");
    try {
      const response = await fetch("/api/staff/bookings", {
        method:"PATCH", headers:{"content-type":"application/json"},
        body:JSON.stringify({ id, status }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(()=>({})) as { error?:string };
        setNotice(payload.error || "Не вдалося змінити стан");
      } else {
        await load();
      }
    } catch {
      setNotice("Помилка мережі — спробуйте ще раз");
    } finally {
      setBusy(0);
    }
  }

  async function assign(study:Study, field:"radiologist"|"radiographer", email:string) {
    setBusy(study.id); setNotice("");
    try {
      const body = field === "radiologist"
        ? { id:study.id, assignedRadiologistEmail:email, assignedRadiographerEmail:study.assignedRadiographerEmail }
        : { id:study.id, assignedRadiologistEmail:study.assignedRadiologistEmail, assignedRadiographerEmail:email };
      const response = await fetch("/api/staff/bookings", {
        method:"PATCH", headers:{"content-type":"application/json"},
        body:JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(()=>({})) as { error?:string };
        setNotice(payload.error || "Не вдалося призначити виконавця");
      } else {
        await load();
      }
    } catch {
      setNotice("Помилка мережі — спробуйте ще раз");
    } finally {
      setBusy(0);
    }
  }

  async function saveView() {
    const name=viewName.trim();
    if (!name) { setNotice("Вкажіть назву варіанта"); return; }
    setViewBusy(true); setNotice("");
    try {
      const response=await fetch("/api/staff/saved-views",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({surface:"studies",name,config:{filter,equipment}}),
      });
      const payload=await response.json().catch(()=>({})) as {error?:string;id?:number};
      if(!response.ok){setNotice(payload.error||"Не вдалося зберегти варіант");return;}
      setViewName("");
      await loadSavedViews();
      if(payload.id)setSelectedViewId(payload.id);
      setNotice("Варіант списку збережено");
    } catch {
      setNotice("Помилка мережі — не вдалося зберегти варіант");
    } finally { setViewBusy(false); }
  }

  function applyView(id:number) {
    setSelectedViewId(id);
    const view=savedViews.find(v=>v.id===id);
    if(!view)return;
    setFilter(view.config.filter||"all");
    setEquipment(view.config.equipment||"all");
    setQuery("");
    setNotice("");
  }

  async function deleteView() {
    if(!selectedViewId)return;
    setViewBusy(true); setNotice("");
    try {
      const response=await fetch("/api/staff/saved-views",{
        method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({surface:"studies",id:selectedViewId}),
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setNotice(payload.error||"Не вдалося видалити варіант");return;}
      setSelectedViewId(0);
      await loadSavedViews();
      setNotice("Варіант списку видалено");
    } catch {
      setNotice("Помилка мережі — не вдалося видалити варіант");
    } finally { setViewBusy(false); }
  }

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.studies.filter((s)=>
      (filter === "all" || s.status === filter)
      && (equipment === "all" || s.equipmentId === equipment)
      && (!q || `${s.code} ${s.name} ${s.service}`.toLowerCase().includes(q)),
    );
  }, [data, filter, equipment, query]);

  const activeStates = useMemo(
    () => (data?.states || []).filter((s)=>s.count > 0),
    [data],
  );

  return <StaffWorkspaceShell
    active="studies"
    title="Видача результатів"
    description="Підписані протоколи й виправлення до видачі пацієнту; нижче — єдиний реєстр досліджень без змішування адміністративної видачі з клінічним редагуванням."
    staffName={staff ? roleLabels[staff.role] : undefined}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied">
      <b>Захищений розділ</b>
      <p>{error}. Увійдіть через дозволений робочий обліковий запис.</p>
      <a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fstudies">Увійти для роботи</a>
    </section> :
    !data ? <p className="dashLoading">Завантаження реєстру…</p> :
    <>
      <div className="studiesOrgBar">
        <span className="studiesOrgBadge">{data.organization.name}</span>
        <small>{data.profile?.label ? `${data.profile.label} · ` : ""}{data.studies.length} досліджень · роль: {roleLabels[data.role]}{data.canManage ? "" : " · лише перегляд"}</small>
      </div>

      {notice && <p className="staffError" role="status" onClick={()=>setNotice("")}>{notice}</p>}

      {pendingDeliveries.length > 0 ? <section aria-labelledby="pending-deliveries-title">
        <div className="studiesOrgBar">
          <span className="studiesOrgBadge" id="pending-deliveries-title">До видачі</span>
          <small>{pendingDeliveries.length} підписаних документів · клінічний текст у цій черзі не відображається</small>
        </div>
        <div className="studiesTableWrap">
          <table className="studiesTable">
            <thead><tr>
              <th>Тип</th><th>Код</th><th>Пацієнт</th><th>Дослідження</th><th>Документ</th><th>Підписав</th><th>Підписано</th><th>Дія</th>
            </tr></thead>
            <tbody>{pendingDeliveries.map((item)=>{
              const key=item.kind === "protocol" ? `protocol:${item.bookingId}` : `addendum:${item.addendumId}`;
              return <tr key={key}>
                <td>{item.kind === "protocol" ? "Протокол" : "Виправлення"}</td>
                <td className="studiesCode">{item.bookingCode}</td>
                <td>{item.patientName || "—"}</td>
                <td>{item.serviceTitle || "—"}</td>
                <td>{item.documentNumber || "—"}{item.kind === "addendum" ? ` · v${item.version}` : ""}</td>
                <td>{item.signedBy || "—"}</td>
                <td>{item.signedAt || "—"}</td>
                <td><button type="button" className="button compact" disabled={deliveryBusy===key}
                  onClick={()=>void deliverResult(item)}>{deliveryBusy===key ? "Видаємо…" : "Видати пацієнту"}</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section> : null}

      <div className="studiesToolbar" aria-label="Варіанти списку">
        <select value={selectedViewId||""} onChange={(e)=>applyView(Number(e.target.value))} aria-label="Мої варіанти списку">
          <option value="">Мої варіанти…</option>
          {savedViews.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input value={viewName} maxLength={48} onChange={(e)=>setViewName(e.target.value)} placeholder="Назва нового варіанта" aria-label="Назва нового варіанта"/>
        <button type="button" className="studiesClear" disabled={viewBusy} onClick={()=>void saveView()}>Зберегти варіант</button>
        {selectedViewId ? <button type="button" className="studiesClear" disabled={viewBusy} onClick={()=>void deleteView()}>Видалити</button> : null}
        <small>Зберігаються стан і апарат; текст пошуку не зберігається.</small>
      </div>

      <div className="studiesToolbar">
        <input type="search" className="studiesSearch" value={query} onChange={(e)=>{setQuery(e.target.value);setSelectedViewId(0);}} placeholder="Пошук: код, пацієнт, дослідження" aria-label="Пошук досліджень"/>
        <select value={equipment} onChange={(e)=>{setEquipment(e.target.value);setSelectedViewId(0);}} aria-label="Апарат">
          <option value="all">Усі апарати</option>
          <option value="ct">КТ</option><option value="xray">Рентген</option><option value="fluoro">Флюорограф</option>
        </select>
        {(query || equipment!=="all" || filter!=="all") && <button type="button" className="studiesClear" onClick={()=>{setQuery("");setEquipment("all");setFilter("all");setSelectedViewId(0);}}>Скинути</button>}
        <span className="studiesResultCount">Показано: {visible.length}</span>
      </div>

      <div className="studiesTabs" role="tablist" aria-label="Фільтр за станом">
        <button type="button" role="tab" aria-selected={filter==="all"}
          className={filter==="all"?"active":""} onClick={()=>{setFilter("all");setSelectedViewId(0);}}>
          Усі <b>{data.studies.length}</b>
        </button>
        {activeStates.map((s)=><button key={s.v} type="button" role="tab" aria-selected={filter===s.v}
          className={filter===s.v?"active":""} onClick={()=>{setFilter(s.v);setSelectedViewId(0);}}>
          {s.l} <b>{s.count}</b>
        </button>)}
      </div>

      {visible.length === 0 ? <p className="dashListEmpty">{query || equipment!=="all" ? "За цим запитом досліджень не знайдено." : "У цьому стані досліджень немає."}</p> :
      <div className="studiesTableWrap">
        <table className="studiesTable">
          <thead><tr>
            <th>Код</th><th>Пацієнт</th><th>Дослідження</th><th>Дата / час</th>
            <th>Апарат</th><th>Стан</th><th>Лікар</th><th>Лаборант</th>{data.features?.dicomPacs ? <th>Знімки</th> : null}<th>Історія</th><th>Дія</th>
          </tr></thead>
          <tbody>
            {visible.map((s)=><tr key={s.id}>
              <td className="studiesCode">{s.code}</td>
              <td>{s.name || "—"}</td>
              <td>{s.service}</td>
              <td className="studiesWhen">{s.desiredDate}{s.desiredTime ? ` ${s.desiredTime}` : ""}</td>
              <td>{equipmentNames[s.equipmentId] || s.equipmentId}</td>
              <td><span className={`studiesState grp-${STATE_GROUP[s.status] || "intake"}`}>{s.stateLabel}</span></td>
              <td>{data.canManage
                ? <select className="studiesAssign" aria-label={`Лікар для ${s.code}`} disabled={busy===s.id}
                    value={s.assignedRadiologistEmail}
                    onChange={(e)=>void assign(s, "radiologist", e.target.value)}>
                    <option value="">— не призначено —</option>
                    {data.radiologists.map((o)=><option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                : <span className={s.radiologistName ? "" : "studiesUnlinked"}>{s.radiologistName || "—"}</span>}</td>
              <td>{data.canManage
                ? <select className="studiesAssign" aria-label={`Лаборант для ${s.code}`} disabled={busy===s.id}
                    value={s.assignedRadiographerEmail}
                    onChange={(e)=>void assign(s, "radiographer", e.target.value)}>
                    <option value="">— не призначено —</option>
                    {data.radiographers.map((o)=><option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                : <span className={s.radiographerName ? "" : "studiesUnlinked"}>{s.radiographerName || "—"}</span>}</td>
              {data.features?.dicomPacs ? <td>{s.studyStatus && s.studyStatus !== "not_linked"
                ? <span className="studiesLinked" title={s.accessionNumber || ""}>прив’язано</span>
                : <span className="studiesUnlinked">—</span>}</td> : null}
              <td><button type="button" className="studiesClear" onClick={()=>setContextStudy(s)}>Історія</button></td>
              <td>
                {data.canManage && s.nextStates.length > 0 ?
                  <select
                    aria-label={`Змінити стан для ${s.code}`}
                    disabled={busy===s.id}
                    value=""
                    onChange={(e)=>void transition(s.id, e.target.value)}
                  >
                    <option value="">Перевести →</option>
                    {s.nextStates.map((n)=><option key={n.v} value={n.v}>{n.l}</option>)}
                  </select>
                  : <span className="studiesTerminal">{s.terminal ? "завершено" : "—"}</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>}

      {data.studies.length >= 500 && <p className="studiesTrunc">Показано найновіші 500 досліджень. Старіші поки не відображаються — уточніть пошук або стан.</p>}
      {contextStudy ? <StudyContextDrawer study={contextStudy} onClose={()=>setContextStudy(null)}/> : null}
    </>}
  </StaffWorkspaceShell>;
}