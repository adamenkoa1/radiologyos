"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

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

const roleLabels: Record<StaffRole,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};
const equipmentNames: Record<string,string> = { ct:"КТ", xray:"Рентген", fluoro:"Флюорограф" };

// Клінічні групи станів — для кольору бейджа й логічного порядку черги.
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

  async function load() {
    const response = await fetch("/api/staff/studies", { cache:"no-store" });
    const payload = await response.json() as Data & { error?:string };
    if (!response.ok) { setError(payload.error || "Немає доступу"); return; }
    setData(payload);
    setStaff({ email:"", displayName:"", role:payload.role });
    setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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

  // Призначення виконавця: reg/admin шлють оновлення на той самий PATCH
  // /api/staff/bookings, що валідує роль виконавця й фіксує подію.
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
    title="Реєстр досліджень"
    description="Усі дослідження організації з єдиним життєвим циклом: стан, обладнання, протокол і знімки в одному місці."
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

      {notice && <p className="staffError" role="alert" onClick={()=>setNotice("")}>{notice}</p>}

      <div className="studiesToolbar">
        <input type="search" className="studiesSearch" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Пошук: код, пацієнт, дослідження" aria-label="Пошук досліджень"/>
        <select value={equipment} onChange={(e)=>setEquipment(e.target.value)} aria-label="Апарат">
          <option value="all">Усі апарати</option>
          <option value="ct">КТ</option><option value="xray">Рентген</option><option value="fluoro">Флюорограф</option>
        </select>
        {(query || equipment!=="all" || filter!=="all") && <button type="button" className="studiesClear" onClick={()=>{setQuery("");setEquipment("all");setFilter("all");}}>Скинути</button>}
        <span className="studiesResultCount">Показано: {visible.length}</span>
      </div>

      <div className="studiesTabs" role="tablist" aria-label="Фільтр за станом">
        <button type="button" role="tab" aria-selected={filter==="all"}
          className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>
          Усі <b>{data.studies.length}</b>
        </button>
        {activeStates.map((s)=><button key={s.v} type="button" role="tab" aria-selected={filter===s.v}
          className={filter===s.v?"active":""} onClick={()=>setFilter(s.v)}>
          {s.l} <b>{s.count}</b>
        </button>)}
      </div>

      {visible.length === 0 ? <p className="dashListEmpty">{query || equipment!=="all" ? "За цим запитом досліджень не знайдено." : "У цьому стані досліджень немає."}</p> :
      <div className="studiesTableWrap">
        <table className="studiesTable">
          <thead><tr>
            <th>Код</th><th>Пацієнт</th><th>Дослідження</th><th>Дата / час</th>
            <th>Апарат</th><th>Стан</th><th>Лікар</th><th>Лаборант</th>{data.features?.dicomPacs ? <th>Знімки</th> : null}<th>Дія</th>
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
    </>}
  </StaffWorkspaceShell>;
}
