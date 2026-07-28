"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };
type Kpi = {
  scheduledToday:number; newToday:number; confirmedToday:number; performedToday:number;
  awaitingProtocol:number; readyToIssue:number; issuedToday:number;
  needImaging:number; availableStudies:number; pacsEnabled:boolean;
  outstandingCount:number; outstandingSum:number; nszuPending:number;
  patients:number; repeatPatients:number; doNotContact:number;
};
type ListItem = { id:number; code:string; name:string; serviceTitle:string; performedAt?:string; protocolNumber?:string; desiredDate?:string; desiredTime?:string };
type Data = {
  today:string; kpi:Kpi;
  equipmentToday:Array<{ id:string; c:number }>;
  lists:{ needProtocol:ListItem[]; readyToIssue:ListItem[]; needImaging:ListItem[]; confirmQueue:ListItem[] };
  staff:StaffInfo;
};

const roleLabels: Record<StaffRole,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};
const equipmentNames: Record<string,string> = { ct:"КТ", xray:"Рентген", fluoro:"Флюорограф" };

function ActionList({ title, items, hint, href, empty }:{
  title:string; items:ListItem[]; hint:string; href:(item:ListItem)=>string; empty:string;
}) {
  return <section className="dashList">
    <div className="dashListHead"><h3>{title}</h3><span>{items.length ? `${items.length}${items.length===6?"+":""}` : ""}</span></div>
    <p className="dashListHint">{hint}</p>
    {items.length === 0 ? <p className="dashListEmpty">{empty}</p> : <ul>
      {items.map((item)=><li key={item.id}>
        <a href={href(item)}>
          <b>{item.serviceTitle}</b>
          <small>{item.code} · {item.name || "—"}{item.protocolNumber ? ` · № ${item.protocolNumber}` : item.desiredDate ? ` · ${item.desiredDate} ${item.desiredTime}` : ""}</small>
          <span aria-hidden="true">→</span>
        </a>
      </li>)}
    </ul>}
  </section>;
}

type ExtEvent = { display: string; summary: string };

function ExternalCalendar() {
  const [state, setState] = useState<{ configured: boolean; events: ExtEvent[]; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/staff/external-calendar", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (active) setState(d); })
      .catch(() => { if (active) setState({ configured: false, events: [] }); });
    return () => { active = false; };
  }, []);
  if (!state || !state.configured) return null;
  return <section className="dashList" style={{ maxWidth: 1500, margin: "16px auto 0" }}>
    <div className="dashListHead"><h3>Google Календар — найближчі події</h3><span>{state.events.length || ""}</span></div>
    <p className="dashListHint">Події з підключеного Google Календаря (налаштування — у розділі «Налаштування»).</p>
    {state.error ? <p className="dashListEmpty">{state.error}</p>
      : state.events.length === 0 ? <p className="dashListEmpty">Найближчих подій немає.</p>
      : <ul>{state.events.map((e, i) => <li key={i}><a><b>{e.summary}</b><small>{e.display}</small></a></li>)}</ul>}
  </section>;
}

export default function DashboardPage() {
  const [data,setData] = useState<Data | null>(null);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [error,setError] = useState("");

  async function load() {
    const response = await fetch("/api/staff/dashboard", { cache:"no-store" });
    const payload = await response.json() as Data & { error?:string };
    if (!response.ok) { setError(payload.error || "Немає доступу"); return; }
    setData(payload); setStaff(payload.staff || null); setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const k = data?.kpi;

  return <StaffWorkspaceShell
    active="dashboard"
    title="Пульт відділення"
    description="Що потребує уваги просто зараз: розклад, виконання, протоколи, знімки, оплати та пацієнти в одному місці."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fdashboard">Увійти для роботи</a></section> :
    !k ? <p className="dashLoading">Завантаження зведення…</p> :
    <>
      <div className="dashKpiGrid">
        <a className="dashKpi dashHero" href="/staff">
          <span>Сьогодні у розкладі</span>
          <b>{k.scheduledToday}</b>
          <small>{k.newToday} нових · {k.confirmedToday} підтверджено · {k.performedToday} виконано</small>
        </a>
        <a className="dashKpi" href="/staff/protocols">
          <span>Потребують протоколу</span><b className={k.awaitingProtocol?"warn":""}>{k.awaitingProtocol}</b>
          <small>{k.readyToIssue} готові до видачі · {k.issuedToday} видано сьогодні</small>
        </a>
        <a className="dashKpi" href="/staff/imaging">
          <span>Без прив’язки знімків</span><b className={k.needImaging?"warn":""}>{k.needImaging}</b>
          <small>{k.availableStudies} у PACS · {k.pacsEnabled?"PACS підключено":"PACS вимкнено"}</small>
        </a>
        <a className="dashKpi" href="/staff/reports">
          <span>Очікують оплати</span><b className={k.outstandingCount?"warn":""}>{k.outstandingCount}</b>
          <small>{k.outstandingSum.toLocaleString("uk-UA")} грн · НСЗУ на перевірці: {k.nszuPending}</small>
        </a>
        <a className="dashKpi" href="/staff/patients">
          <span>Пацієнтів у базі</span><b>{k.patients}</b>
          <small>{k.repeatPatients} повторних · {k.doNotContact} «не турбувати»</small>
        </a>
        <div className="dashKpi equipment">
          <span>Завантаження апаратів сьогодні</span>
          <div className="dashEquip">
            {["ct","xray","fluoro"].map((id)=>{
              const value = data?.equipmentToday.find((e)=>e.id===id)?.c || 0;
              return <div key={id}><b>{value}</b><small>{equipmentNames[id]}</small></div>;
            })}
          </div>
        </div>
      </div>

      <div className="dashLists">
        <ActionList title="Потребують протоколу" items={data!.lists.needProtocol}
          hint="Виконані дослідження без готового висновку" empty="Усі виконані дослідження мають протокол."
          href={(item)=>`/staff/protocols?open=${item.id}`}/>
        <ActionList title="Готові до видачі" items={data!.lists.readyToIssue}
          hint="Протокол готовий — лишилось видати пацієнту" empty="Немає протоколів, що очікують видачі."
          href={(item)=>`/staff/protocols?open=${item.id}`}/>
        <ActionList title="Без прив’язки знімків" items={data!.lists.needImaging}
          hint="Виконані дослідження без DICOM-студії" empty="Усі дослідження прив’язані до знімків."
          href={(item)=>`/staff/imaging?open=${item.id}`}/>
        <ActionList title="Черга підтвердження" items={data!.lists.confirmQueue}
          hint="Нові заявки, що очікують на реакцію реєстратури" empty="Нових непідтверджених заявок немає."
          href={()=>"/staff#bookings"}/>
      </div>
      <ExternalCalendar/>
    </>}
  </StaffWorkspaceShell>;
}
