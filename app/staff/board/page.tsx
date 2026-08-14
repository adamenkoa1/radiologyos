"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { stateLabel } from "../../../lib/study-state";

type StaffInfo = { email:string; displayName:string; role:string };
type Booking = {
  id:number; code:string; name:string; phone:string; service:string; equipmentId:string;
  desiredDate:string; desiredTime:string; status:string; patientCategory?:string;
  paymentStatus?:string; assignedRadiologistEmail?:string;
};

type Column = {
  key:string;
  title:string;
  hint:string;
  states:string[];
};

const COLUMNS:Column[] = [
  {
    key:"planned",
    title:"Заплановано",
    hint:"Заявки та підтверджені записи",
    states:["new","requested","needs_verification","scheduled","rescheduled","confirmed"],
  },
  {
    key:"arrived",
    title:"Прибув",
    hint:"Пацієнт уже у відділенні",
    states:["arrived"],
  },
  {
    key:"inroom",
    title:"У кабінеті",
    hint:"Черга та виконання дослідження",
    states:["queued","in_progress"],
  },
  {
    key:"reporting",
    title:"Очікує опису",
    hint:"Знімки є, протокол ще не готовий",
    states:["performed","images_ready","reporting"],
  },
  {
    key:"ready",
    title:"Готово / видано",
    hint:"Протокол готовий або результат видано",
    states:["protocol_ready","issued","completed"],
  },
];

const EQUIPMENT:Record<string,string> = { ct:"КТ", xray:"Рентген", fluoro:"Флюорограф" };
const isContrast = (service:string) => /контраст|ангіограф/i.test(service || "");

function todayKyiv() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Kyiv", year:"numeric", month:"2-digit", day:"2-digit",
  }).format(new Date());
}

function patientRoute(booking:Booking) {
  if (["performed","images_ready","reporting","protocol_ready","issued","completed"].includes(booking.status)) {
    return `/staff/protocols?open=${booking.id}`;
  }
  return `/staff/appointments?date=${encodeURIComponent(booking.desiredDate)}&view=list`;
}

export default function StudyBoardPage() {
  const [bookings,setBookings] = useState<Booking[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [date,setDate] = useState(todayKyiv());
  const [query,setQuery] = useState("");
  const [loaded,setLoaded] = useState(false);
  const [error,setError] = useState("");

  async function load() {
    const res = await fetch("/api/staff/bookings", { cache:"no-store" });
    const payload = await res.json().catch(()=>({})) as { bookings?:Booking[]; staff?:StaffInfo; error?:string };
    if (!res.ok || !payload.staff) {
      setError(payload.error || "Немає доступу");
      setLoaded(true);
      return;
    }
    setBookings(payload.bookings || []);
    setStaff(payload.staff);
    setError("");
    setLoaded(true);
  }

  useEffect(()=>{
    const timer = window.setTimeout(()=>{ void load(); },0);
    return ()=>window.clearTimeout(timer);
  },[]);

  const scoped = useMemo(()=>{
    const q = query.trim().toLowerCase();
    return bookings
      .filter((b)=>b.desiredDate === date)
      .filter((b)=>!["cancelled","no_show"].includes(b.status))
      .filter((b)=>!q || `${b.name} ${b.phone} ${b.code} ${b.service}`.toLowerCase().includes(q))
      .sort((a,b)=>(a.desiredTime || "").localeCompare(b.desiredTime || ""));
  },[bookings,date,query]);

  const exceptions = useMemo(()=>bookings
    .filter((b)=>b.desiredDate === date && ["cancelled","no_show"].includes(b.status))
    .sort((a,b)=>(a.desiredTime || "").localeCompare(b.desiredTime || "")),
  [bookings,date]);

  return <StaffWorkspaceShell
    active="board"
    title="Дошка досліджень"
    description="Операційний потік дня: від запису пацієнта до готового та виданого результату."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff?.role}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fboard">Увійти</a></section>
      : !loaded ? <p className="dashLoading">Завантаження дошки…</p>
      : <section className="studyBoardShell">
          <div className="studyBoardToolbar">
            <label><span>Дата</span><input type="date" value={date} onChange={(e)=>setDate(e.target.value)} /></label>
            <label className="studyBoardSearch"><span>Пошук</span><input type="search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Пацієнт, телефон, код, послуга" /></label>
            <button type="button" onClick={()=>void load()}>Оновити</button>
            <a href="/staff/appointments">Планувальник</a>
          </div>

          <div className="studyBoardSummary" aria-label="Стан потоку">
            {COLUMNS.map((column)=>{
              const count = scoped.filter((b)=>column.states.includes(b.status)).length;
              return <span key={column.key}><b>{count}</b>{column.title}</span>;
            })}
          </div>

          <div className="studyKanban" aria-label="Канбан досліджень">
            {COLUMNS.map((column)=>{
              const items = scoped.filter((b)=>column.states.includes(b.status));
              return <section className={`studyKanbanColumn col-${column.key}`} key={column.key}>
                <header>
                  <div><h2>{column.title}</h2><p>{column.hint}</p></div>
                  <span>{items.length}</span>
                </header>
                <div className="studyKanbanCards">
                  {items.length === 0 ? <p className="studyKanbanEmpty">Немає записів</p> : items.map((booking)=><a className={`studyKanbanCard mod-${booking.equipmentId || "other"}`} href={patientRoute(booking)} key={booking.id}>
                    <div className="studyKanbanCardTop">
                      <time>{booking.desiredTime || "—"}</time>
                      <span>{EQUIPMENT[booking.equipmentId] || booking.equipmentId || "Дослідження"}</span>
                    </div>
                    <b>{booking.name || "Без імені"}</b>
                    <p>{booking.service}</p>
                    <div className="studyKanbanTags">
                      <span className={`studyStateTag st-${booking.status}`}>{stateLabel(booking.status)}</span>
                      {isContrast(booking.service) && <span className="studyTag contrast">Контраст</span>}
                      {booking.patientCategory === "civilian" && booking.paymentStatus !== "paid" && <span className="studyTag pay">Оплата</span>}
                    </div>
                    <small>{booking.code}</small>
                  </a>)}
                </div>
              </section>;
            })}
          </div>

          {exceptions.length > 0 && <details className="studyBoardExceptions">
            <summary>Скасовані / неявка <span>{exceptions.length}</span></summary>
            <div>{exceptions.map((b)=><a href={`/staff/appointments?date=${encodeURIComponent(b.desiredDate)}&view=list`} key={b.id}><time>{b.desiredTime}</time><b>{b.name || "Без імені"}</b><span>{stateLabel(b.status)}</span></a>)}</div>
          </details>}
        </section>}
  </StaffWorkspaceShell>;
}
