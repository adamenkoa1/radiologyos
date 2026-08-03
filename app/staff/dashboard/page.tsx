"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import WeekCalendar, { type CalBooking, type CalStaffOption } from "../week-calendar";

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
type QueueState = { v:string; l:string; count:number };
type Data = {
  today:string; kpi:Kpi;
  equipmentToday:Array<{ id:string; c:number }>;
  equipmentWeek:Array<{ d:string; id:string; c:number }>;
  weekStart:string;
  clinicalQueue:QueueState[];
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

const EQUIP: Record<string,string> = { ct:"КТ", xray:"Рентген", fluoro:"Флюорограф" };

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
  const [bookings,setBookings] = useState<CalBooking[]>([]);
  const [options,setOptions] = useState<CalStaffOption[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [error,setError] = useState("");
  const [toast,setToast] = useState("");
  const [busyId,setBusyId] = useState<number | null>(null);

  async function load() {
    const [dashRes, bookingsRes] = await Promise.all([
      fetch("/api/staff/dashboard", { cache:"no-store" }),
      fetch("/api/staff/bookings", { cache:"no-store" }),
    ]);
    // Доступ визначаємо за заявками (доступні реєстратору й лікарям), а не за
    // зведеною аналітикою, яка лише для адміністратора. Так Пульт лишається
    // корисним для всіх ролей, а не блокується стіною «лише адмін».
    const bookingsData = await bookingsRes.json().catch(() => ({})) as
      { bookings?:CalBooking[]; staffOptions?:CalStaffOption[]; staff?:StaffInfo; error?:string };
    if (!bookingsRes.ok || !bookingsData.staff) { setError(bookingsData.error || "Немає доступу"); return; }
    setStaff(bookingsData.staff);
    setBookings(bookingsData.bookings || []);
    setOptions(bookingsData.staffOptions || []);
    setError("");
    // KPI-аналітика — лише для адміністратора; 403 тут не блокує Пульт.
    if (dashRes.ok) {
      const payload = await dashRes.json().catch(() => null) as Data | null;
      if (payload?.kpi) setData(payload);
    } else {
      setData(null);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Нові/перенесені заявки, що чекають на реакцію реєстратури — миготять,
  // доки їх не підтвердять. Найновіші згори.
  const pending = useMemo(() => bookings
    .filter(b => b.status === "new" || b.status === "rescheduled")
    .sort((a, b) => (b.code || "").localeCompare(a.code || "")),
  [bookings]);

  const canManage = staff?.role === "admin" || staff?.role === "registrar";

  async function confirmBooking(id:number) {
    setBusyId(id); setToast("");
    try {
      const res = await fetch("/api/staff/bookings", {
        method:"PATCH", headers:{"content-type":"application/json"},
        body:JSON.stringify({ id, confirm:true }),
      });
      const data = await res.json().catch(() => ({})) as { error?:string; reminder?:{ sent:number; skipped:number; failed:number } | null };
      if (!res.ok) { setToast(data.error || "Не вдалося підтвердити запис"); return; }
      setBookings(cur => cur.map(b => b.id === id ? { ...b, status:"confirmed" } : b));
      const r = data.reminder;
      setToast(r?.sent
        ? "✓ Підтверджено · повідомлення у WhatsApp надіслано пацієнту"
        : r?.failed
          ? "✓ Підтверджено, але WhatsApp не надіслався — перевірте підключення у розділі WhatsApp"
          : "✓ Підтверджено · WhatsApp-сповіщення вимкнено або не підключено");
    } catch {
      setToast("Помилка мережі — спробуйте ще раз");
    } finally {
      setBusyId(null);
    }
  }

  const k = data?.kpi;

  return <StaffWorkspaceShell
    active="dashboard"
    title="Пульт відділення"
    description="Нові заявки, розклад і те, що потребує уваги — в одному місці."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fdashboard">Увійти для роботи</a></section> :
    !staff ? <p className="dashLoading">Завантаження зведення…</p> :
    <>
      {toast && <p className="dashToast" role="status" onClick={()=>setToast("")}>{toast}</p>}

      {/* Дія передусім: нові заявки миготять, доки їх не підтвердять; підтвердження одним кліком. */}
      <section className="dashPending">
        <div className="dashPendingHead">
          <h2>Нові заявки {pending.length ? <span className="dashPendingBadge">{pending.length}</span> : null}</h2>
          <small>{canManage
            ? "Натисніть «Підтвердити» — пацієнту одразу піде повідомлення у WhatsApp."
            : "Заявки, що очікують підтвердження реєстратури."}</small>
        </div>
        {pending.length === 0
          ? <p className="dashListEmpty">Нових непідтверджених заявок немає — усе опрацьовано.</p>
          : <ul className="dashPendingList">
              {pending.map(b => (
                <li key={b.id} className="dashPendingRow">
                  <span className={`dashPendingDot ${b.status}`} aria-hidden="true" />
                  <div className="dashPendingWho">
                    <b>{b.name || "Без імені"}</b>
                    <small>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""} · {b.desiredDate} {b.desiredTime}</small>
                  </div>
                  <a className="dashPendingPhone" href={`tel:${b.phone}`}>{b.phone}</a>
                  {canManage
                    ? <button type="button" className="dashConfirmBtn" disabled={busyId===b.id} onClick={()=>void confirmBooking(b.id)}>
                        {busyId===b.id ? "…" : "✓ Підтвердити"}
                      </button>
                    : <span className="dashPendingTag">очікує</span>}
                </li>
              ))}
            </ul>}
      </section>

      {/* Зведені показники — лише для адміністратора (аналітика по відділенню). */}
      {k && <div className="dashKpiStrip">
        <a className="dashStat hero" href="/staff/appointments"><b>{k.scheduledToday}</b><span>сьогодні у розкладі</span><small>{k.newToday} нових · {k.confirmedToday} підтв.</small></a>
        <a className="dashStat" href="/staff/protocols"><b className={k.awaitingProtocol?"warn":""}>{k.awaitingProtocol}</b><span>потребують протоколу</span><small>{k.readyToIssue} до видачі</small></a>
        <a className="dashStat" href="/staff/imaging"><b className={k.needImaging?"warn":""}>{k.needImaging}</b><span>без знімків</span><small>{k.pacsEnabled?"PACS активний":"PACS вимкнено"}</small></a>
        <a className="dashStat" href="/staff/reports"><b className={k.outstandingCount?"warn":""}>{k.outstandingCount}</b><span>очікують оплати</span><small>{k.outstandingSum.toLocaleString("uk-UA")} грн</small></a>
        <a className="dashStat" href="/staff/patients"><b>{k.patients}</b><span>пацієнтів</span><small>{k.repeatPatients} повторних</small></a>
      </div>}

      {/* Об'єднаний календар записів прямо в пульті */}
      <section className="dashCalendar">
        <div className="dashCalendarHead"><h2>Розклад</h2><a href="/staff/book" className="dashCalNew">+ Записати пацієнта</a></div>
        <WeekCalendar bookings={bookings} options={options} initialView="week" />
      </section>

      {/* Завантаженість апаратів за 7 днів (сьогодні та 6 попередніх) — адмін-аналітика */}
      {k && data && <section className="dashLoad">
        <div className="dashListHead"><h3>Завантаженість апаратів · 7 днів</h3><span>{data.weekStart} — {data.today}</span></div>
        {(() => {
          const days:string[] = [];
          for (let i = 6; i >= 0; i--) { const dt = new Date(`${data.today}T12:00:00Z`); dt.setUTCDate(dt.getUTCDate() - i); days.push(dt.toISOString().slice(0,10)); }
          const at = (id:string, d:string) => data.equipmentWeek.find((e)=>e.id===id && e.d===d)?.c || 0;
          const peak = Math.max(1, ...data.equipmentWeek.filter((e)=>["ct","xray","fluoro"].includes(e.id)).map((e)=>e.c));
          const dow = (d:string) => ["Нд","Пн","Вт","Ср","Чт","Пт","Сб"][new Date(`${d}T12:00:00Z`).getUTCDay()];
          return <div className="dashLoadGrid" style={{ gridTemplateColumns:`120px repeat(${days.length}, 1fr)` }}>
            <span className="dashLoadCorner" />
            {days.map((d)=><span key={d} className={`dashLoadDay${d===data.today?" today":""}`}>{dow(d)}<small>{d.slice(8,10)}.{d.slice(5,7)}</small></span>)}
            {["ct","xray","fluoro"].map((id)=><Fragment key={id}>
              <span className="dashLoadRow">{equipmentNames[id]}</span>
              {days.map((d)=>{ const v = at(id,d); return <span key={d} className="dashLoadCell" title={`${equipmentNames[id]} · ${d}: ${v}`}>
                <i style={{ height:`${Math.round((v/peak)*100)}%` }} className={v?"":"empty"} /><b>{v||""}</b>
              </span>; })}
            </Fragment>)}
          </div>;
        })()}
      </section>}

      {k && data?.clinicalQueue?.length ? <a className="dashQueue" href="/staff/studies" aria-label="Відкрити реєстр досліджень">
        <div className="dashQueueHead"><b>Клінічна черга</b><small>Активні стани дослідження · відкрити реєстр →</small></div>
        <div className="dashQueueRow">
          {data.clinicalQueue.map((q)=><div key={q.v} className="dashQueueCell">
            <b className={q.count?"":"muted"}>{q.count}</b><span>{q.l}</span>
          </div>)}
        </div>
      </a> : null}

      {k && data && <div className="dashLists">
        <ActionList title="Потребують протоколу" items={data.lists.needProtocol}
          hint="Виконані дослідження без готового висновку" empty="Усі виконані дослідження мають протокол."
          href={(item)=>`/staff/protocols?open=${item.id}`}/>
        <ActionList title="Готові до видачі" items={data.lists.readyToIssue}
          hint="Протокол готовий — лишилось видати пацієнту" empty="Немає протоколів, що очікують видачі."
          href={(item)=>`/staff/protocols?open=${item.id}`}/>
        <ActionList title="Без прив’язки знімків" items={data.lists.needImaging}
          hint="Виконані дослідження без DICOM-студії" empty="Усі дослідження прив’язані до знімків."
          href={(item)=>`/staff/imaging?open=${item.id}`}/>
      </div>}
      <ExternalCalendar/>
    </>}
  </StaffWorkspaceShell>;
}
