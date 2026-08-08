"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { type CalBooking } from "../week-calendar";

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
const EQUIP: Record<string,string> = { ct:"КТ", xray:"Рентген", fluoro:"Флюорограф" };

// Компактний статус запису для агенди «на сьогодні».
const STATUS_UK: Record<string,string> = {
  new:"нова", rescheduled:"перенесено", confirmed:"підтв.", queued:"у черзі",
  in_progress:"виконується", images_ready:"є знімки", reporting:"опис",
  protocol_ready:"протокол", completed:"завершено", performed:"виконано",
};
function statusGroup(s:string) {
  if (s === "new" || s === "rescheduled") return "new";
  if (s === "confirmed") return "ok";
  if (s === "cancelled") return "off";
  return "done";
}

// Ознаки запису, потрібні лікарю «з першого погляду» — без окремих полів у БД.
const isContrast = (b:CalBooking) => /контраст|ангіограф/i.test(b.service || "");
const needsPay = (b:CalBooking) => b.patientCategory === "civilian" && b.paymentStatus !== "paid";
// Дослідження вже зроблено, але висновку ще немає — черга опису.
const NEEDS_REPORT = new Set(["performed", "images_ready", "reporting"]);
const needsReport = (b:CalBooking) => NEEDS_REPORT.has(b.status);
// Посилання «написати у WhatsApp»: лишаємо тільки цифри номера.
const waLink = (phone:string) => `https://wa.me/${(phone || "").replace(/[^\d]/g, "")}`;
// Кольорова смужка за типом дослідження — розпізнавання за частку секунди.
const modClass = (equipmentId:string) => `mod-${equipmentId || "other"}`;
// Лікар: маємо лише email — показуємо частину до «@» з великої літери.
function doctorShort(email?:string) {
  if (!email) return "";
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}
// Хвилини від «зараз» (Київ) до часу запису сьогодні. Від'ємні — вже минув.
function nowMinutesKyiv() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/Kyiv", hour:"2-digit", minute:"2-digit", hour12:false }).formatToParts(new Date());
  const h = Number(parts.find(p=>p.type==="hour")?.value || 0);
  const m = Number(parts.find(p=>p.type==="minute")?.value || 0);
  return h * 60 + m;
}
function minsUntil(time:string, now:number) {
  const [h, m] = (time || "").split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0) - now;
}
// Короткий підпис «коли»: зараз / через N хв / N год / −N хв (минув).
function whenLabel(delta:number|null) {
  if (delta === null) return null;
  if (delta <= -60) return { text:`−${Math.round(-delta/60)} год`, cls:"past" };
  if (delta < 0) return { text:`−${-delta} хв`, cls:"past" };
  if (delta <= 5) return { text:"зараз", cls:"now" };
  if (delta < 60) return { text:`через ${delta} хв`, cls:"soon" };
  return { text:`через ${Math.round(delta/60)} год`, cls:"" };
}

// Швидкі фільтри агенди — кожен відповідає реальній ознаці запису.
type AgendaFilter = "all" | "contrast" | "pay" | "ct" | "xray";
const AGENDA_FILTERS: Array<{ id:AgendaFilter; label:string }> = [
  { id:"all", label:"Усі" },
  { id:"contrast", label:"Контраст" },
  { id:"pay", label:"Перевірити оплату" },
  { id:"ct", label:"КТ" },
  { id:"xray", label:"Рентген" },
];
function matchFilter(b:CalBooking, f:AgendaFilter) {
  if (f === "all") return true;
  if (f === "contrast") return isContrast(b);
  if (f === "pay") return needsPay(b);
  if (f === "ct") return b.equipmentId === "ct";
  if (f === "xray") return b.equipmentId === "xray" || b.equipmentId === "fluoro";
  return true;
}

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
  const [bookings,setBookings] = useState<CalBooking[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [error,setError] = useState("");
  const [toast,setToast] = useState("");
  const [busyId,setBusyId] = useState<number | null>(null);
  const [agendaFilter,setAgendaFilter] = useState<AgendaFilter>("all");
  const [nowMin,setNowMin] = useState(() => nowMinutesKyiv());

  async function load() {
    const [dashRes, bookingsRes] = await Promise.all([
      fetch("/api/staff/dashboard", { cache:"no-store" }),
      fetch("/api/staff/bookings", { cache:"no-store" }),
    ]);
    // Доступ визначаємо за заявками (доступні реєстратору й лікарям), а не за
    // зведеною аналітикою, яка лише для адміністратора. Так Пульт лишається
    // корисним для всіх ролей, а не блокується стіною «лише адмін».
    const bookingsData = await bookingsRes.json().catch(() => ({})) as
      { bookings?:CalBooking[]; staff?:StaffInfo; error?:string };
    if (!bookingsRes.ok || !bookingsData.staff) { setError(bookingsData.error || "Немає доступу"); return; }
    setStaff(bookingsData.staff);
    setBookings(bookingsData.bookings || []);
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

  // «Через N хв» на розкладі має лишатися свіжим — оновлюємо щохвилини.
  useEffect(() => {
    const id = window.setInterval(() => setNowMin(nowMinutesKyiv()), 30000);
    return () => window.clearInterval(id);
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

  // Розклад на сьогодні (Київ). Пульт дає лише короткий огляд — повний
  // тижневий календар живе в окремому розділі «Календар записів».
  const today = data?.today || new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Kyiv" }).format(new Date());
  const todayAgenda = useMemo(() => bookings
    .filter(b => b.desiredDate === today && b.status !== "cancelled")
    .sort((a, b) => (a.desiredTime || "").localeCompare(b.desiredTime || "")),
  [bookings, today]);

  // Лічильники «місії» — рахуємо із заявок, тому працюють для будь-якої ролі,
  // а не лише для адміністратора (у якого є зведена аналітика).
  const mc = useMemo(() => ({
    contrastToday: todayAgenda.filter(isContrast).length,
    payToday: todayAgenda.filter(needsPay).length,
    toReport: bookings.filter(needsReport).length,
  }), [todayAgenda, bookings]);

  const agendaShown = useMemo(
    () => todayAgenda.filter(b => matchFilter(b, agendaFilter)),
    [todayAgenda, agendaFilter],
  );

  return <StaffWorkspaceShell
    active="dashboard"
    title="Пульт відділення"
    description="Хто наступний, що термінове і що потребує уваги — в одному екрані."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fdashboard">Увійти для роботи</a></section> :
    !staff ? <p className="dashLoading">Завантаження зведення…</p> :
    <>
      {toast && <p className="dashToast" role="status" onClick={()=>setToast("")}>{toast}</p>}

      {/* Панель місії: головні числа дня в один рядок. Клік веде до дії. */}
      <nav className="dashMc" aria-label="Головні показники дня">
        <a className="dashMcItem red" href="#dash-pending">
          <b>{pending.length}</b><span>нових заявок</span>
        </a>
        <a className="dashMcItem orange" href="#dash-agenda" onClick={()=>setAgendaFilter("contrast")}>
          <b>{mc.contrastToday}</b><span>з контрастом</span>
        </a>
        <a className="dashMcItem green" href="#dash-agenda" onClick={()=>setAgendaFilter("all")}>
          <b>{todayAgenda.length}</b><span>пацієнтів сьогодні</span>
        </a>
        <a className="dashMcItem blue" href="/staff/protocols">
          <b>{k ? k.awaitingProtocol : mc.toReport}</b><span>описати протокол</span>
        </a>
        <a className="dashMcItem violet" href="#dash-agenda" onClick={()=>setAgendaFilter("pay")}>
          <b>{mc.payToday}</b><span>перевірити оплату</span>
        </a>
      </nav>

      {/* Три рівні пріоритету: 1) робота зараз, 2) робота сьогодні, 3) аналітика. */}
      <p className="dashTier t1">Робота зараз</p>

      {/* Дія передусім: нові заявки — картками, з телефоном, WhatsApp і підтвердженням. */}
      <section className="dashPending" id="dash-pending">
        <div className="dashPendingHead">
          <h2>Нові заявки {pending.length ? <span className="dashPendingBadge">{pending.length}</span> : null}</h2>
          <small>{canManage
            ? "Натисніть «Підтвердити» — пацієнту одразу піде повідомлення у WhatsApp."
            : "Заявки, що очікують підтвердження реєстратури."}</small>
        </div>
        {pending.length === 0
          ? <p className="dashListEmpty">Нових непідтверджених заявок немає — усе опрацьовано.</p>
          : <div className="dashCards">
              {pending.map(b => (
                <article key={b.id} className={`dashCard ${b.status} ${modClass(b.equipmentId)}`}>
                  <div className="dashCardTop">
                    <span className={`dashCardTag ${b.status}`}>{b.status === "rescheduled" ? "Перенесено" : "Нова"}</span>
                    {isContrast(b) && <span className="dashCardFlag">Контраст</span>}
                    {needsPay(b) && <span className="dashCardFlag pay">Оплата</span>}
                  </div>
                  <b className="dashCardName">{b.name || "Без імені"}</b>
                  <span className="dashCardSvc">{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}</span>
                  <span className="dashCardWhen">{b.desiredDate} · {b.desiredTime || "—"}{doctorShort(b.assignedRadiologistEmail) ? ` · 👨‍⚕️ ${doctorShort(b.assignedRadiologistEmail)}` : ""}</span>
                  <div className="dashCardActions">
                    <a className="dashCardBtn" href={`tel:${b.phone}`} title={b.phone}>📞</a>
                    <a className="dashCardBtn wa" href={waLink(b.phone)} target="_blank" rel="noreferrer">WhatsApp</a>
                    {canManage
                      ? <button type="button" className="dashCardBtn ok" disabled={busyId===b.id} onClick={()=>void confirmBooking(b.id)}>
                          {busyId===b.id ? "…" : "✓ Підтвердити"}
                        </button>
                      : <span className="dashCardBtn wait">очікує</span>}
                  </div>
                </article>
              ))}
            </div>}
      </section>

      {/* Центр Пульта — хто наступний. Розклад на сьогодні з швидкими фільтрами. */}
      <section className="dashCalendar" id="dash-agenda">
        <div className="dashCalendarHead">
          <h2>Розклад на сьогодні {todayAgenda.length ? <span className="dashAgendaCount">{agendaShown.length}{agendaFilter!=="all"?`/${todayAgenda.length}`:""}</span> : null}</h2>
          <div className="dashCalActions">
            <a href="/staff/appointments">Календар записів →</a>
            <a href="/staff/book" className="dashCalNew">+ Записати пацієнта</a>
          </div>
        </div>
        <div className="dashChips" role="tablist" aria-label="Фільтр розкладу">
          {AGENDA_FILTERS.map(f => {
            const n = f.id === "all" ? todayAgenda.length : todayAgenda.filter(b => matchFilter(b, f.id)).length;
            return <button key={f.id} type="button" role="tab" aria-selected={agendaFilter===f.id}
              className={`dashChip${agendaFilter===f.id?" on":""}`} onClick={()=>setAgendaFilter(f.id)}>
              {f.label}{n ? <i>{n}</i> : null}
            </button>;
          })}
        </div>
        {todayAgenda.length === 0
          ? <p className="dashListEmpty">На сьогодні записів немає.</p>
          : agendaShown.length === 0
          ? <p className="dashListEmpty">За фільтром «{AGENDA_FILTERS.find(f=>f.id===agendaFilter)?.label}» записів немає.</p>
          : <ul className="dashAgenda">
              {agendaShown.map(b => {
                const active = b.status !== "completed" && b.status !== "performed" && b.status !== "issued";
                const when = active ? whenLabel(minsUntil(b.desiredTime, nowMin)) : null;
                const doc = doctorShort(b.assignedRadiologistEmail);
                return <li key={b.id} className={`dashAgendaRow ${modClass(b.equipmentId)}`}>
                  <time>{b.desiredTime || "—"}{when ? <em className={`dashAgendaWhen ${when.cls}`}>{when.text}</em> : null}</time>
                  <div className="dashAgendaWho">
                    <b>{b.name || "Без імені"}</b>
                    <small>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doc ? ` · 👨‍⚕️ ${doc}` : ""}</small>
                  </div>
                  {isContrast(b) && <span className="dashAgendaFlag">Контраст</span>}
                  {needsPay(b) && <span className="dashAgendaFlag pay">Оплата</span>}
                  <span className={`dashAgendaStatus st-${statusGroup(b.status)}`}>{STATUS_UK[b.status] || b.status}</span>
                </li>;
              })}
            </ul>}
      </section>

      {/* Рівень 2 — робота на сьогодні: що треба довести до кінця (лише адмін). */}
      {k && data && <>
      <p className="dashTier t2">Робота сьогодні</p>
      <div className="dashLists">
        <ActionList title="Потребують протоколу" items={data.lists.needProtocol}
          hint="Виконані дослідження без готового висновку" empty="Усі виконані дослідження мають протокол."
          href={(item)=>`/staff/protocols?open=${item.id}`}/>
        <ActionList title="Готові до видачі" items={data.lists.readyToIssue}
          hint="Протокол готовий — лишилось видати пацієнту" empty="Немає протоколів, що очікують видачі."
          href={(item)=>`/staff/protocols?open=${item.id}`}/>
        <ActionList title="Без прив’язки знімків" items={data.lists.needImaging}
          hint="Виконані дослідження без DICOM-студії" empty="Усі дослідження прив’язані до знімків."
          href={(item)=>`/staff/imaging?open=${item.id}`}/>
      </div>
      </>}

      {/* Рівень 3 — аналітика: потрібна рідше, ніж «хто наступний». Лише адмін. */}
      {k && data && <section className="dashAnalytics">
        <p className="dashTier t3">Аналітика</p>

        <div className="dashKpiStrip">
          <a className="dashStat hero" href="/staff/appointments"><b>{k.scheduledToday}</b><span>сьогодні у розкладі</span><small>{k.newToday} нових · {k.confirmedToday} підтв.</small></a>
          <a className="dashStat" href="/staff/protocols"><b className={k.awaitingProtocol?"warn":""}>{k.awaitingProtocol}</b><span>потребують протоколу</span><small>{k.readyToIssue} до видачі</small></a>
          <a className="dashStat" href="/staff/imaging"><b className={k.needImaging?"warn":""}>{k.needImaging}</b><span>без знімків</span><small>{k.pacsEnabled?"PACS активний":"PACS вимкнено"}</small></a>
          <a className="dashStat" href="/staff/reports"><b className={k.outstandingCount?"warn":""}>{k.outstandingCount}</b><span>очікують оплати</span><small>{k.outstandingSum.toLocaleString("uk-UA")} грн</small></a>
          <a className="dashStat" href="/staff/patients"><b>{k.patients}</b><span>пацієнтів</span><small>{k.repeatPatients} повторних</small></a>
        </div>

        <div className="dashLoad">
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
        </div>

        {data.clinicalQueue?.length ? <a className="dashQueue" href="/staff/studies" aria-label="Відкрити реєстр досліджень">
          <div className="dashQueueHead"><b>Клінічна черга</b><small>Активні стани дослідження · відкрити реєстр →</small></div>
          <div className="dashQueueRow">
            {data.clinicalQueue.map((q)=><div key={q.v} className="dashQueueCell">
              <b className={q.count?"":"muted"}>{q.count}</b><span>{q.l}</span>
            </div>)}
          </div>
        </a> : null}
      </section>}
      <ExternalCalendar/>
    </>}
  </StaffWorkspaceShell>;
}
