"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import BookingDrawer from "../booking-drawer";
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
type ListItem = { id:number; code:string; name:string; serviceTitle:string; performedAt?:string; protocolNumber?:string; desiredDate?:string; desiredTime?:string; phone?:string; failedAt?:string };
type QueueState = { v:string; l:string; count:number };
type Data = {
  today:string; kpi:Kpi;
  equipmentToday:Array<{ id:string; c:number }>;
  equipmentWeek:Array<{ d:string; id:string; c:number }>;
  weekStart:string;
  clinicalQueue:QueueState[];
  lists:{ needProtocol:ListItem[]; readyToIssue:ListItem[]; needImaging:ListItem[]; confirmQueue:ListItem[]; undelivered:ListItem[] };
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
// Пацієнт як центр: імʼя веде в єдину картку пацієнта (CRM за номером).
const patientHref = (phone:string) => `/staff/patients?phone=${(phone || "").replace(/[^\d]/g, "")}`;
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
          <small><span className="codeTag">{item.code}</span> · {item.name || "—"}{item.protocolNumber ? ` · № ${item.protocolNumber}` : item.desiredDate ? ` · ${item.desiredDate} ${item.desiredTime}` : ""}</small>
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
  // Підтверджені, кому сповіщення НЕ дійшло — робочий список «передзвонити»
  // (на сесію; сам факт збою також лишається в patient_notifications).
  const [needsCall,setNeedsCall] = useState<CalBooking[]>([]);
  // Пакетне підтвердження: вибрані заявки + індикатор виконання.
  const [selected,setSelected] = useState<Set<number>>(new Set());
  const [batchBusy,setBatchBusy] = useState(false);
  const toggleSel = (id:number) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [agendaFilter,setAgendaFilter] = useState<AgendaFilter>("all");
  const [nowMin,setNowMin] = useState(() => nowMinutesKyiv());
  const [openId,setOpenId] = useState<number | null>(null);

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

  // Дата «сьогодні» (Київ) — потрібна і для черги заявок, і для розкладу нижче.
  const today = data?.today || new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Kyiv" }).format(new Date());

  // Нові/перенесені заявки, що чекають на реакцію реєстратури — миготять,
  // доки їх не підтвердять. Минулі (дата дослідження вже пройшла) не показуємо —
  // підтверджувати вже пізно. Найновіші згори.
  const pending = useMemo(() => bookings
    .filter(b => (b.status === "new" || b.status === "rescheduled") && (b.desiredDate || "") >= today)
    .sort((a, b) => (b.code || "").localeCompare(a.code || "")),
  [bookings, today]);

  const canManage = staff?.role === "admin" || staff?.role === "registrar";

  // Одне підтвердження: мутує стан заявки, повертає підсумок (без тосту),
  // щоб і поштучний, і пакетний режим користувались тією самою логікою.
  async function sendConfirm(id:number): Promise<{ ok:boolean; outcome:"delivered"|"failed"|"skipped"; error?:string }> {
    const res = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({ id, confirm:true }),
    });
    const data = await res.json().catch(() => ({})) as { error?:string; reminder?:{ sent:number; skipped:number; failed:number } | null };
    if (!res.ok) return { ok:false, outcome:"failed", error:data.error };
    setBookings(cur => cur.map(b => b.id === id ? { ...b, status:"confirmed" } : b));
    const r = data.reminder;
    // r відсутнє/null → відправлення впало; r.failed>0 → шлюз не доставив.
    const notNotified = !r || (r.failed ?? 0) > 0;
    if (notNotified) {
      const b = bookings.find(x => x.id === id);
      if (b) setNeedsCall(cur => cur.some(x => x.id === id) ? cur : [...cur, { ...b, status:"confirmed" }]);
      return { ok:true, outcome:"failed" };
    }
    return { ok:true, outcome:(r?.sent ?? 0) > 0 ? "delivered" : "skipped" };
  }

  async function confirmBooking(id:number) {
    setBusyId(id); setToast("");
    try {
      const o = await sendConfirm(id);
      if (!o.ok) { setToast(o.error || "Не вдалося підтвердити запис"); return; }
      setToast(o.outcome === "failed"
        ? "⚠ Підтверджено, але сповіщення НЕ доставлено — зателефонуйте пацієнту"
        : o.outcome === "delivered"
          ? "✓ Підтверджено · повідомлення у WhatsApp надіслано пацієнту"
          : "✓ Підтверджено · сповіщення пропущено (вимкнено або немає телефону)");
    } catch {
      setToast("Помилка мережі — спробуйте ще раз");
    } finally {
      setBusyId(null);
    }
  }

  // Пакетне підтвердження обраних заявок: послідовно (щоб не перевантажити
  // WhatsApp-шлюз), з агрегованим підсумком; невдалі — у «Потребує дзвінка».
  async function confirmSelected() {
    const ids = pending.filter(b => selected.has(b.id)).map(b => b.id);
    if (!ids.length) return;
    setBatchBusy(true); setToast("");
    let done = 0, failed = 0, errors = 0;
    for (const id of ids) {
      try { const o = await sendConfirm(id); if (!o.ok) errors += 1; else { done += 1; if (o.outcome === "failed") failed += 1; } }
      catch { errors += 1; }
    }
    setSelected(new Set());
    setBatchBusy(false);
    const parts = [`Підтверджено ${done}`];
    if (failed) parts.push(`${failed} без сповіщення — у списку дзвінків`);
    if (errors) parts.push(`${errors} з помилкою`);
    setToast((failed || errors ? "⚠ " : "✓ ") + parts.join(" · "));
  }

  async function rescheduleBooking(id:number, date:string, time:string) {
    setBusyId(id); setToast("");
    try {
      const res = await fetch("/api/staff/bookings", {
        method:"PATCH", headers:{"content-type":"application/json"},
        body:JSON.stringify({ id, desiredDate:date, desiredTime:time }),
      });
      const data = await res.json().catch(() => ({})) as { error?:string };
      if (!res.ok) { setToast(data.error || "Не вдалося перенести запис"); return; }
      setBookings(cur => cur.map(b => b.id === id ? { ...b, desiredDate:date, desiredTime:time, status:"rescheduled" } : b));
      setToast(`✓ Перенесено на ${date} ${time}`);
    } catch {
      setToast("Помилка мережі — спробуйте ще раз");
    } finally {
      setBusyId(null);
    }
  }

  const k = data?.kpi;

  // Розклад на сьогодні (Київ). Пульт дає лише короткий огляд — повний
  // тижневий календар живе в окремому розділі «Календар записів».
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
      {toast && <p className={`dashToast${toast.startsWith("⚠") ? " warn" : ""}`} role="status" onClick={()=>setToast("")}>{toast}</p>}

      {/* Стійкий робочий список: підтверджено, але сповіщення не дійшло —
          реєстратор має зателефонувати вручну, а не покладатись на зниклий тост. */}
      {needsCall.length > 0 &&
        <section className="dashNeedsCall" aria-label="Потребує дзвінка">
          <div className="dashNeedsCallHead">
            <b>☎ Потребує дзвінка · {needsCall.length}</b>
            <small>Підтверджено, але сповіщення пацієнту не доставлено. Зателефонуйте вручну.</small>
          </div>
          <ul>
            {needsCall.map(b => (
              <li key={b.id}>
                <span className="dashNeedsCallWho"><b>{b.name || "Без імені"}</b><small>{b.service}{b.desiredDate ? ` · ${b.desiredDate} ${b.desiredTime || ""}` : ""}</small></span>
                <span className="dashNeedsCallActions">
                  <a className="dashCardBtn" href={`tel:${b.phone}`} title={b.phone}>📞 {b.phone || "—"}</a>
                  <button type="button" className="dashCardBtn wa" onClick={()=>setOpenId(b.id)}>Повідомити</button>
                  <button type="button" className="dashCardBtn ok" onClick={()=>setNeedsCall(cur => cur.filter(x => x.id !== b.id))}>✓ Подзвонив</button>
                </span>
              </li>
            ))}
          </ul>
        </section>}

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

      {/* Дія передусім: нові заявки — картками, з телефоном, безпечним повідомленням і підтвердженням. */}
      <section className="dashPending" id="dash-pending">
        <div className="dashPendingHead">
          <h2>Нові заявки {pending.length ? <span className="dashPendingBadge">{pending.length}</span> : null}</h2>
          <small>{canManage
            ? "Позначте кілька й підтвердьте разом, або по одній. Сповіщення надсилається через захищений канал."
            : "Заявки, що очікують підтвердження реєстратури."}</small>
          {canManage && pending.length > 0 &&
            <div className="dashPendingTools">
              <button type="button" className="dashSelAll"
                onClick={()=>setSelected(selected.size === pending.length ? new Set() : new Set(pending.map(b=>b.id)))}>
                {selected.size === pending.length ? "Зняти вибір" : "Обрати всі"}
              </button>
              <button type="button" className="dashBatchBtn" disabled={selected.size === 0 || batchBusy}
                onClick={()=>void confirmSelected()}>
                {batchBusy ? "Підтверджую…" : `✓ Підтвердити обрані · ${selected.size}`}
              </button>
            </div>}
        </div>
        {pending.length === 0
          ? <p className="dashListEmpty">Нових непідтверджених заявок немає — усе опрацьовано.</p>
          : <div className="dashCards">
              {pending.map(b => (
                <article key={b.id} className={`dashCard ${b.status} ${modClass(b.equipmentId)}${selected.has(b.id) ? " picked" : ""}`}>
                  <div className="dashCardTop">
                    {canManage &&
                      <label className="dashCardPick" title="Обрати для пакетного підтвердження">
                        <input type="checkbox" checked={selected.has(b.id)} onChange={()=>toggleSel(b.id)} />
                      </label>}
                    <span className={`dashCardTag ${b.status}`}>{b.status === "rescheduled" ? "Перенесено" : "Нова"}</span>
                    {isContrast(b) && <span className="dashCardFlag">Контраст</span>}
                    {needsPay(b) && <span className="dashCardFlag pay">Оплата</span>}
                  </div>
                  <b className="dashCardName">{b.phone ? <a className="patLink" href={patientHref(b.phone)}>{b.name || "Без імені"}</a> : (b.name || "Без імені")}</b>
                  <span className="dashCardSvc">{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}</span>
                  <span className="dashCardWhen">{b.desiredDate} · {b.desiredTime || "—"}{doctorShort(b.assignedRadiologistEmail) ? ` · 👨‍⚕️ ${doctorShort(b.assignedRadiologistEmail)}` : ""}</span>
                  <div className="dashCardActions">
                    <a className="dashCardBtn" href={`tel:${b.phone}`} title={b.phone}>📞</a>
                    <button type="button" className="dashCardBtn wa" onClick={()=>setOpenId(b.id)}>Повідомити</button>
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
                return <li key={b.id}>
                  <button type="button" className={`dashAgendaRow ${modClass(b.equipmentId)}`} onClick={()=>setOpenId(b.id)}>
                    <time>{b.desiredTime || "—"}{when ? <em className={`dashAgendaWhen ${when.cls}`}>{when.text}</em> : null}</time>
                    <div className="dashAgendaWho">
                      <b>{b.name || "Без імені"}</b>
                      <small>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doc ? ` · 👨‍⚕️ ${doc}` : ""}</small>
                    </div>
                    {isContrast(b) && <span className="dashAgendaFlag">Контраст</span>}
                    {needsPay(b) && <span className="dashAgendaFlag pay">Оплата</span>}
                    <span className={`dashAgendaStatus st-${statusGroup(b.status)}`}>{STATUS_UK[b.status] || b.status}</span>
                  </button>
                </li>;
              })}
            </ul>}
      </section>

      {/* Рівень 2 — робота на сьогодні: показуємо лише те, що справді потребує
          дії. Порожні списки не малюємо — жодних карток «усе гаразд» (лише адмін). */}
      {k && data && (() => {
        const lists = [
          { key:"np", title:"Потребують протоколу", items:data.lists.needProtocol,
            hint:"Виконані дослідження без готового висновку", href:(item:ListItem)=>`/staff/protocols?open=${item.id}` },
          { key:"ri", title:"Готові до видачі", items:data.lists.readyToIssue,
            hint:"Протокол готовий — лишилось видати пацієнту", href:(item:ListItem)=>`/staff/protocols?open=${item.id}` },
          { key:"ni", title:"Без прив’язки знімків", items:data.lists.needImaging,
            hint:"Виконані дослідження без DICOM-студії", href:(item:ListItem)=>`/staff/imaging?open=${item.id}` },
        ].filter(l => l.items.length > 0);
        if (!lists.length) return null;
        return <>
          <p className="dashTier t2">Робота сьогодні</p>
          <div className="dashLists">
            {lists.map(l => <ActionList key={l.key} title={l.title} items={l.items} hint={l.hint} href={l.href} empty=""/>)}
          </div>
        </>;
      })()}

      {/* Стійкий звіт із patient_notifications: кому система НЕ доставила
          нагадування (і від cron, і від підтверджень) — переживає перезавантаження. */}
      {data && data.lists.undelivered.length > 0 &&
        <section className="dashList dashUndelivered" id="dash-undelivered">
          <div className="dashListHead"><h3>Недоставлені сповіщення</h3><span>{data.lists.undelivered.length}{data.lists.undelivered.length === 8 ? "+" : ""}</span></div>
          <p className="dashListHint">Пацієнти, яким система не змогла надіслати нагадування. Зателефонуйте вручну.</p>
          <ul>
            {data.lists.undelivered.map(item => (
              <li key={item.id} className="dashUndItem">
                <span className="dashUndWho"><b>{item.name || "—"}</b><small>{item.serviceTitle}{item.desiredDate ? ` · ${item.desiredDate} ${item.desiredTime || ""}` : ""}</small></span>
                <span className="dashUndActions">
                  <a className="dashCardBtn" href={`tel:${item.phone || ""}`} title={item.phone}>📞 {item.phone || "—"}</a>
                  <button type="button" className="dashCardBtn wa" onClick={()=>setOpenId(item.id)}>Повідомити</button>
                </span>
              </li>
            ))}
          </ul>
        </section>}

      {/* Рівень 3 — аналітика: керівникові, не лікарю. Згорнута за замовчуванням,
          щоб Пульт лишався фокусованим; розгортається одним кліком (лише адмін). */}
      {k && data && <details className="dashAnalytics">
        <summary className="dashTier t3">Аналітика відділення <span className="dashTierToggle">розгорнути</span></summary>

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
      </details>}
      <ExternalCalendar/>

      {/* Єдиний Workspace на Пульті: клік по розкладу відкриває контекст + дію. */}
      {(() => {
        const ob = bookings.find(b => b.id === openId) || null;
        return ob ? <BookingDrawer
          key={ob.id}
          booking={ob}
          all={bookings}
          doctorName={doctorShort(ob.assignedRadiologistEmail)}
          onClose={()=>setOpenId(null)}
          onOpen={setOpenId}
          onConfirm={canManage ? (id)=>void confirmBooking(id) : undefined}
          confirming={busyId===ob.id}
          onReschedule={canManage ? (id,date,time)=>void rescheduleBooking(id,date,time) : undefined}
          rescheduling={busyId===ob.id}
        /> : null;
      })()}
    </>}
  </StaffWorkspaceShell>;
}
