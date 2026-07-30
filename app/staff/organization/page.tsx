"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Option = { v:string; l:string };
type Data = {
  organization:{ id:number; name:string; slug:string };
  canManage:boolean;
  profileType:string;
  profileLabel:string;
  flags:Record<string,boolean>;
  overrides:Record<string,boolean>;
  catalog:{ profiles:Option[]; features:Option[] };
};

export default function OrganizationPage() {
  const [data,setData] = useState<Data|null>(null);
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  const [savedAt,setSavedAt] = useState("");

  async function load() {
    const response = await fetch("/api/staff/org-profile", { cache:"no-store" });
    const payload = await response.json() as Data & { error?:string };
    if (!response.ok) { setError(payload.error || "Немає доступу"); return; }
    setData(payload); setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save(next:{ profileType?:string; flags?:Record<string,boolean> }) {
    if (!data?.canManage) return;
    setSaving(true);
    try {
      const response = await fetch("/api/staff/org-profile", {
        method:"PATCH", headers:{"content-type":"application/json"},
        body:JSON.stringify(next),
      });
      const payload = await response.json().catch(()=>({})) as { error?:string };
      if (!response.ok) { window.alert(payload.error || "Не вдалося зберегти"); return; }
      await load();
      setSavedAt(new Date().toLocaleTimeString("uk-UA"));
    } finally {
      setSaving(false);
    }
  }

  return <StaffWorkspaceShell
    active="organization"
    title="Організація та профіль"
    description="Профіль-конфігурація й перемикачі можливостей (feature flags) цієї організації. Один код — різні профілі."
  >
    {error ? <section className="accessDenied">
      <b>Захищений розділ</b>
      <p>{error}. Увійдіть через дозволений робочий обліковий запис.</p>
      <a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Forganization">Увійти для роботи</a>
    </section> :
    !data ? <p className="dashLoading">Завантаження профілю…</p> :
    <div className="orgProfile">
      <div className="orgProfileHead">
        <span className="studiesOrgBadge">{data.organization.name}</span>
        <small>Профіль: <b>{data.profileLabel}</b>{data.canManage ? "" : " · лише перегляд"}{savedAt ? ` · збережено ${savedAt}` : ""}</small>
      </div>

      <section className="orgProfileCard">
        <h3>Профіль організації</h3>
        <p className="orgProfileHint">Визначає набір можливостей за замовчуванням. Змінюйте обережно — впливає на поведінку модулів.</p>
        <div className="orgProfilePicker">
          {data.catalog.profiles.map((p)=><button
            key={p.v} type="button"
            className={p.v===data.profileType ? "active" : ""}
            disabled={!data.canManage || saving}
            onClick={()=>void save({ profileType:p.v })}
          >{p.l}</button>)}
        </div>
      </section>

      <section className="orgProfileCard">
        <h3>Можливості (feature flags)</h3>
        <p className="orgProfileHint">Точкові перевизначення дефолтів профілю для цієї організації.</p>
        <div className="orgFlagList">
          {data.catalog.features.map((f)=>{
            const on = !!data.flags[f.v];
            const overridden = f.v in data.overrides;
            return <label key={f.v} className="orgFlag">
              <input
                type="checkbox" checked={on}
                disabled={!data.canManage || saving}
                onChange={(e)=>void save({ flags:{ [f.v]: e.target.checked } })}
              />
              <span className="orgFlagName">{f.l}</span>
              <span className={`orgFlagState ${on?"on":"off"}`}>{on?"увімкнено":"вимкнено"}</span>
              {overridden ? <span className="orgFlagBadge" title="Перевизначено вручну">override</span> : null}
            </label>;
          })}
        </div>
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
