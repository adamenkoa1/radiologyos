"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "./workspace-shell";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };
type StaffOption = { email:string; displayName:string; role:StaffRole };
type Booking = {
  id:number; code:string; name:string; phone:string; patientEmail:string; service:string;
  serviceCode:string; equipmentId:string; durationMinutes:number;
  desiredDate:string; desiredTime:string; referral:string;
  patientCategory:string; referralType:string; referralNumber:string;
  marketingSource:string; protocolNumber:string; protocolStatus:string; protocolUpdatedAt:string;
  assignedRadiologistEmail:string; assignedRadiographerEmail:string;
  performedAt:string; anatomicalRegionsCount:number;
  protocolReadyAt:string; protocolIssuedAt:string;
  paidAmount:number; externalReference:string;
  paymentStatus:string; paymentAmount:number; paymentMethod:string;
  nszuStatus:string; nszuReference:string; listedPrice:number;
  comment:string; status:string; createdAt:string;
};
type BookingEvent = { id:number; bookingId:number; action:string; details:string; actor:string; createdAt:string };
type PatientNotification = { id:number; bookingId:number; kind:string; channel:string; recipient:string; status:string; error:string; createdAt:string; sentAt:string };
type ReminderResult = { sent:number; skipped:number; failed:number } | null | undefined;
type StaffNote = { bookingId:number; note:string; updatedBy:string; updatedAt:string };
type Equipment = { id:string; name:string; slotMinutes:number; start:string; end:string };
type EquipmentBlock = {
  id:number; equipmentId:string; blockedDate:string; startTime:string; endTime:string; reason:string;
};
type StaffMember = {
  email:string; phone:string; displayName:string; role:StaffRole; active:number; createdAt:string;
};

const labels: Record<string,string> = {
  new:"Нова", confirmed:"Підтверджена", rescheduled:"Перенесена",
  completed:"Завершена", cancelled:"Скасована",
};
const roleLabels: Record<StaffRole,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};
const categoryLabels: Record<string,string> = { civilian:"Цивільний маршрут", military:"Військовий маршрут" };
const referralLabels: Record<string,string> = {
  eh_referral:"е-Направлення", military_referral:"Направлення військової частини",
  paper_referral:"Паперове направлення", none:"Без направлення", other:"Інше",
};
const protocolLabels: Record<string,string> = {
  not_started:"Не розпочато", in_progress:"В роботі", ready:"Готовий", issued:"Видано",
};
const paymentLabels: Record<string,string> = {
  not_set:"Не визначено", verification_required:"Потрібна перевірка пільги", pending:"Очікує оплати", paid:"Оплачено",
  not_required:"Оплата не потрібна", refunded:"Повернено",
};
const paymentMethodLabels: Record<string,string> = {
  "":"Не вказано", cash:"Готівка", card:"Картка",
  bank_transfer:"Банківський переказ", privat_link:"Посилання ПриватБанк", other:"Інше",
};
const nszuLabels: Record<string,string> = {
  not_applicable:"Не застосовується", pending:"Очікує перевірки",
  confirmed:"Підтверджено", rejected:"Відхилено",
};
const notificationStatusLabels: Record<string,string> = {
  sent:"надіслано", skipped:"пропущено", failed:"помилка", queued:"у черзі",
};
const notificationChannelLabels: Record<string,string> = { sms:"SMS", email:"e-mail" };

function reminderNote(result:ReminderResult):string {
  if (!result) return "";
  if (result.sent) return ` Нагадування пацієнту надіслано (${result.sent}).`;
  if (result.failed) return " Нагадування не надіслалося — перевірте шлюз у Налаштуваннях.";
  if (result.skipped) return " Нагадування не надсилалося (вимкнено або немає адреси/шлюзу).";
  return "";
}

const eventLabels: Record<string,string> = {
  created:"Заявку створено", rescheduled:"Перенесено", staff_note:"Оновлено нотатку",
  status_changed:"Змінено статус", protocol_updated:"Оновлено протокол",
  finance_updated:"Оновлено оплату / НСЗУ", staff_assigned:"Призначено виконавців",
  execution_recorded:"Зафіксовано виконання", protocol_document_saved:"Збережено протокол",
  ai_draft_generated:"Сформовано AI-чернетку",
};

function todayInKyiv() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Kyiv", year:"numeric", month:"2-digit", day:"2-digit",
  }).format(new Date());
}

const uaApptDay = new Intl.DateTimeFormat("uk-UA", { weekday:"long", day:"numeric", month:"long" });
function formatApptDay(dateStr:string) {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr || "Без дати";
  const label = uaApptDay.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function pluralAppt(n:number) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "запис";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "записи";
  return "записів";
}

const STATUS_TABS: Array<{ v:string; l:string }> = [
  { v:"all", l:"Усі" },
  { v:"new", l:"Нові" },
  { v:"confirmed", l:"Підтверджені" },
  { v:"rescheduled", l:"Перенесені" },
  { v:"completed", l:"Завершені" },
  { v:"cancelled", l:"Скасовані" },
];

// Перенесення запису з реального розкладу: показує лише вільні слоти обраного
// апарата на обрану дату (через /api/availability), як у формі для пацієнта.
function RescheduleForm({ item, today, onSubmit }:{
  item:Booking; today:string; onSubmit:(date:string,time:string)=>void | Promise<void>;
}) {
  const [date,setDate] = useState(item.desiredDate);
  const [time,setTime] = useState(item.desiredTime);
  const [times,setTimes] = useState<string[]>([]);
  const [loading,setLoading] = useState(false);
  const [loaded,setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadSlots() {
      if (!date || date < today) {
        if (active) { setTimes([]); setLoaded(true); setLoading(false); }
        return;
      }
      if (active) { setLoading(true); setLoaded(false); }
      try {
        const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}&serviceCode=${encodeURIComponent(item.serviceCode)}`, { cache:"no-store" });
        const data = await response.json() as { times?:string[] };
        if (!active) return;
        const free = Array.isArray(data.times) ? data.times : [];
        // Поточний слот заявки лічильник вважає зайнятим — повертаємо його як варіант.
        const merged = date === item.desiredDate && item.desiredTime && !free.includes(item.desiredTime)
          ? [...free, item.desiredTime].sort()
          : free;
        setTimes(merged);
        setTime(prev => merged.includes(prev)
          ? prev
          : (date === item.desiredDate && merged.includes(item.desiredTime) ? item.desiredTime : merged[0] || ""));
      } catch {
        if (active) setTimes([]);
      } finally {
        if (active) { setLoading(false); setLoaded(true); }
      }
    }
    void loadSlots();
    return () => { active = false; };
  }, [date, item.serviceCode, item.desiredDate, item.desiredTime, today]);

  const hasSlots = times.length > 0;
  return <form className="rescheduleForm" onSubmit={event => { event.preventDefault(); if (time) void onSubmit(date, time); }}>
    <small>Перенести запис</small>
    <input name="date" type="date" required min={today} value={date} onChange={event => setDate(event.target.value)}/>
    <select name="time" required aria-label="Вільний час" value={time} disabled={loading || !hasSlots} onChange={event => setTime(event.target.value)}>
      {loading ? <option value="">Завантаження…</option>
        : !hasSlots ? <option value="">Немає вільних слотів</option>
        : times.map(slot => <option value={slot} key={slot}>{slot}{slot === item.desiredTime && date === item.desiredDate ? " · поточний" : ""}</option>)}
    </select>
    <button type="submit" disabled={loading || !hasSlots || !time}>Зберегти новий час</button>
    <span className="rescheduleHint">{
      loading ? "Перевіряємо вільний час…"
        : hasSlots ? `${times.length} вільних слотів на ${date} · ${item.durationMinutes} хв`
        : loaded ? "Немає вільних слотів — оберіть іншу дату" : ""
    }</span>
  </form>;
}

export default function StaffPage() {
  const [items,setItems] = useState<Booking[]>([]);
  const [events,setEvents] = useState<BookingEvent[]>([]);
  const [notes,setNotes] = useState<StaffNote[]>([]);
  const [notifications,setNotifications] = useState<PatientNotification[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [equipment,setEquipment] = useState<Equipment[]>([]);
  const [blocks,setBlocks] = useState<EquipmentBlock[]>([]);
  const [members,setMembers] = useState<StaffMember[]>([]);
  const [staffOptions,setStaffOptions] = useState<StaffOption[]>([]);
  const [error,setError] = useState("");
  const [actionError,setActionError] = useState("");
  const [actionSuccess,setActionSuccess] = useState("");
  const [filter,setFilter] = useState("all");
  const [equipmentFilter,setEquipmentFilter] = useState("all");
  const [dayFilter,setDayFilter] = useState("");
  const [query,setQuery] = useState("");

  async function load() {
    const [bookingsResponse,equipmentResponse] = await Promise.all([
      fetch("/api/staff/bookings", { cache:"no-store" }),
      fetch("/api/staff/equipment", { cache:"no-store" }),
    ]);
    const data = await bookingsResponse.json() as {
      bookings?:Booking[]; events?:BookingEvent[]; notes?:StaffNote[]; staff?:StaffInfo;
      staffOptions?:StaffOption[]; notifications?:PatientNotification[]; error?:string;
    };
    if (!bookingsResponse.ok) { setError(data.error || "Немає доступу"); return; }
    const equipmentData = await equipmentResponse.json() as {
      equipment?:Equipment[]; blocks?:EquipmentBlock[]; error?:string;
    };
    if (!equipmentResponse.ok) { setError(equipmentData.error || "Не вдалося завантажити обладнання"); return; }
    setItems(data.bookings || []);
    setEvents(data.events || []);
    setNotes(data.notes || []);
    setNotifications(data.notifications || []);
    setStaff(data.staff || null);
    setStaffOptions(data.staffOptions || []);
    setEquipment(equipmentData.equipment || []);
    setBlocks(equipmentData.blocks || []);
    if (data.staff?.role === "admin") {
      const membersResponse = await fetch("/api/staff/members", { cache:"no-store" });
      const membersData = await membersResponse.json() as { members?:StaffMember[]; error?:string };
      if (!membersResponse.ok) { setError(membersData.error || "Не вдалося завантажити персонал"); return; }
      setMembers(membersData.members || []);
    } else {
      setMembers([]);
    }
    setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function changeStatus(id:number,status:string) {
    setActionError(""); setActionSuccess("");
    const response = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({id,status}),
    });
    const data = await response.json() as { error?:string };
    if (!response.ok) { setActionError(data.error || "Не вдалося змінити статус"); return; }
    setItems(current => current.map(item => item.id === id ? {...item,status} : item));
  }

  async function reschedule(id:number,desiredDate:string,desiredTime:string) {
    setActionError(""); setActionSuccess("");
    const response = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({id,desiredDate,desiredTime}),
    });
    const data = await response.json() as { error?:string; reminder?:ReminderResult };
    if (!response.ok) { setActionError(data.error || "Не вдалося перенести запис"); return; }
    setItems(current => current.map(item => item.id === id ? {...item,desiredDate,desiredTime,status:"rescheduled"} : item));
    setActionSuccess(`Новий час запису збережено.${reminderNote(data.reminder)}`);
    void load();
  }

  async function confirmBooking(id:number) {
    setActionError(""); setActionSuccess("");
    const response = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({id,confirm:true}),
    });
    const data = await response.json() as { error?:string; reminder?:ReminderResult };
    if (!response.ok) { setActionError(data.error || "Не вдалося підтвердити запис"); return; }
    setItems(current => current.map(item => item.id === id ? {...item,status:"confirmed"} : item));
    // Одразу відкриваємо розклад (тиждень) на даті цього запису.
    const target = items.find(item => item.id === id)?.desiredDate;
    window.location.assign(`/staff/appointments?view=week&date=${target || ""}`);
  }

  async function saveNote(id:number,note:string) {
    setActionError(""); setActionSuccess("");
    const response = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({id,note}),
    });
    const data = await response.json() as { error?:string };
    if (!response.ok) { setActionError(data.error || "Не вдалося зберегти нотатку"); return; }
    setNotes(current => [
      ...current.filter(item=>item.bookingId!==id),
      {bookingId:id,note,updatedBy:staff?.email || "ви",updatedAt:new Date().toISOString()},
    ]);
    setActionSuccess("Внутрішню нотатку збережено.");
  }

  async function saveOperations(id:number,payload:Partial<Booking>,successMessage:string) {
    setActionError(""); setActionSuccess("");
    const response = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({id,...payload}),
    });
    const data = await response.json() as Partial<Booking> & { error?:string };
    if (!response.ok) { setActionError(data.error || "Не вдалося зберегти зміни"); return; }
    setItems(current => current.map(item => item.id === id ? {...item,...payload,...data} : item));
    setActionSuccess(successMessage);
  }

  async function addEquipmentBlock(form:HTMLFormElement) {
    setActionError(""); setActionSuccess("");
    const data = new FormData(form);
    const response = await fetch("/api/staff/equipment", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({
        equipmentId:String(data.get("equipmentId")),
        blockedDate:String(data.get("blockedDate")),
        startTime:String(data.get("startTime")),
        endTime:String(data.get("endTime")),
        reason:String(data.get("reason")),
      }),
    });
    const result = await response.json() as { error?:string };
    if (!response.ok) { setActionError(result.error || "Не вдалося заблокувати час"); return; }
    form.reset();
    setActionSuccess("Період недоступності обладнання додано.");
    await load();
  }

  async function removeEquipmentBlock(id:number) {
    setActionError(""); setActionSuccess("");
    const response = await fetch(`/api/staff/equipment?id=${id}`, { method:"DELETE" });
    const data = await response.json() as { error?:string };
    if (!response.ok) { setActionError(data.error || "Не вдалося видалити блокування"); return; }
    setBlocks(current => current.filter(block => block.id !== id));
    setActionSuccess("Блокування часу видалено.");
  }

  async function saveStaffMember(form:HTMLFormElement) {
    setActionError(""); setActionSuccess("");
    const data = new FormData(form);
    const response = await fetch("/api/staff/members", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({
        phone:String(data.get("phone")),
        displayName:String(data.get("displayName")),
        role:String(data.get("role")),
        active:String(data.get("active")) !== "false",
        password:String(data.get("password") || ""),
      }),
    });
    const result = await response.json() as { error?:string; needsPassword?:boolean };
    if (!response.ok) { setActionError(result.error || "Не вдалося зберегти доступ"); return; }
    form.reset();
    setActionSuccess(result.needsPassword
      ? "Працівника додано. Задайте йому пароль, щоб він міг увійти."
      : "Доступ працівника збережено.");
    await load();
  }

  // Базові фільтри (апарат/дата/пошук) — від них рахуються лічильники на табах.
  const baseFiltered = useMemo(() => items
    .filter(item => equipmentFilter === "all" || item.equipmentId === equipmentFilter)
    .filter(item => !dayFilter || item.desiredDate === dayFilter)
    .filter(item => !query.trim() || `${item.name} ${item.phone} ${item.code} ${item.service} ${item.serviceCode}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a,b)=>`${a.desiredDate} ${a.desiredTime}`.localeCompare(`${b.desiredDate} ${b.desiredTime}`)),
  [items,equipmentFilter,dayFilter,query]);
  const statusCounts = useMemo(() => {
    const counts:Record<string,number> = { all:baseFiltered.length };
    for (const item of baseFiltered) counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, [baseFiltered]);
  const visible = useMemo(() => baseFiltered.filter(item => filter === "all" || item.status === filter), [baseFiltered, filter]);
  const groupedByDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const item of visible) {
      const key = item.desiredDate || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [visible]);
  const today = todayInKyiv();
  const canManage = staff?.role === "admin" || staff?.role === "registrar";
  const canProtocol = staff?.role === "admin" || staff?.role === "radiologist";
  const canFinance = staff?.role === "admin" || staff?.role === "registrar";

  return <StaffWorkspaceShell
    active="overview"
    title="Записи"
    description="Записи пацієнтів за статусами й днями. Керування кожним записом — протокол, оплата, виконання — у деталях запису."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff">Увійти для роботи</a></section> :
    <>
      <section className="workspaceQuickGrid" aria-label="Швидкі дії">
        <a className="workspaceTodayCard" href="#schedule">
          <span>Сьогодні, {today}</span>
          <strong>{items.filter(i=>i.desiredDate===today).length}</strong>
          <b>записів у розкладі</b>
          <small>{items.filter(i=>i.desiredDate===today&&i.status==="confirmed").length} підтверджено · {items.filter(i=>i.desiredDate===today&&i.status==="new").length} нових</small>
        </a>
        <a href="/staff/dashboard"><span className="quickGlyph">▣</span><b>Пульт відділення</b><small>Що потребує уваги зараз</small></a>
        <a href="#bookings"><span className="quickGlyph">≡</span><b>Черга заявок</b><small>Перегляд і зміна статусів</small></a>
        <a href="/staff/reports"><span className="quickGlyph">▥</span><b>Звіти</b><small>Аналітика та експорт Excel</small></a>
      </section>

      <section className="staffStats" id="overview">
        <article><span>Усього</span><b>{items.length}</b></article>
        <article><span>Нові</span><b>{items.filter(i=>i.status==="new").length}</b></article>
        <article><span>На сьогодні</span><b>{items.filter(i=>i.desiredDate===today).length}</b></article>
        <article><span>Підтверджені</span><b>{items.filter(i=>i.status==="confirmed").length}</b></article>
      </section>
      <div className="apptTabs" id="schedule" role="tablist" aria-label="Статус записів">
        {STATUS_TABS.map(tab=><button
          key={tab.v}
          type="button"
          role="tab"
          aria-selected={filter===tab.v}
          className={`apptTab${filter===tab.v?" active":""}`}
          onClick={()=>setFilter(tab.v)}
        >{tab.l}<span className="apptTabCount">{statusCounts[tab.v] || 0}</span></button>)}
      </div>
      <div className="staffTools">
        <label>Дата <input type="date" value={dayFilter} onChange={e=>setDayFilter(e.target.value)}/></label>
        <label>Апарат <select value={equipmentFilter} onChange={e=>setEquipmentFilter(e.target.value)}><option value="all">Усе обладнання</option>{equipment.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>Пошук <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пацієнт, код, телефон…"/></label>
        <div className="toolButtons"><button onClick={()=>{setDayFilter(today);setFilter("all")}}>Сьогодні</button><button onClick={()=>{setDayFilter("");setFilter("all");setEquipmentFilter("all");setQuery("");}}>Скинути</button><button onClick={()=>window.print()}>Друк</button><button onClick={()=>void load()}>Оновити</button></div>
      </div>
      <p className="scheduleCaption">{dayFilter?`Записи на ${dayFilter}`:"Усі дати"} · {visible.length} {pluralAppt(visible.length)}</p>
      {actionError&&<p className="staffError" role="alert">{actionError}</p>}
      {actionSuccess&&<p className="staffSuccess" role="status">{actionSuccess}</p>}

      {staff?.role === "admin" && <section className="staffAdmin" id="staff-admin">
        <div>
          <p className="eyebrow">Доступ персоналу</p>
          <h2>Працівники та ролі</h2>
          <p>Додавайте реєстраторів, лікарів і лаборантів без зміни програмного коду.</p>
        </div>
        <form className="staffMemberAdd" onSubmit={event=>{event.preventDefault();void saveStaffMember(event.currentTarget);}}>
          <label><span>Номер телефону</span><input name="phone" type="tel" inputMode="tel" required placeholder="0XX XXX XX XX"/><span className="fieldHint">Без +38, напр.: 0972808899</span></label>
          <label><span>Ім’я працівника</span><input name="displayName" maxLength={120} placeholder="ПІБ або посада"/></label>
          <label><span>Роль</span><select name="role" defaultValue="registrar">{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>PIN-код для входу</span><input name="password" type="password" inputMode="numeric" minLength={6} maxLength={6} autoComplete="new-password" placeholder="6 цифр"/></label>
          <input name="active" type="hidden" value="true"/>
          <button type="submit">Додати працівника</button>
        </form>
        <div className="staffMemberList">
          {members.map(member=><form key={member.email} onSubmit={event=>{event.preventDefault();void saveStaffMember(event.currentTarget);}}>
            <input name="phone" type="hidden" value={member.phone}/>
            <label><span>Телефон</span><b>{member.phone || member.email}</b></label>
            <label><span>Ім’я</span><input name="displayName" defaultValue={member.displayName} maxLength={120}/></label>
            <label><span>Роль</span><select name="role" defaultValue={member.role}>{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Доступ</span><select name="active" defaultValue={member.active ? "true":"false"}><option value="true">Активний</option><option value="false">Вимкнений</option></select></label>
            <label><span>Новий PIN-код</span><input name="password" type="password" inputMode="numeric" minLength={6} maxLength={6} autoComplete="new-password" placeholder="6 цифр (порожньо — без змін)"/></label>
            <button type="submit">Зберегти</button>
          </form>)}
        </div>
      </section>}

      {staff?.role === "admin" && <section className="equipmentAdmin" id="equipment">
        <div>
          <p className="eyebrow">Розклад обладнання</p>
          <h2>Простої та технічні вікна</h2>
          <p>Заблокований період одразу зникає зі списку доступного часу для пацієнтів.</p>
        </div>
        <form onSubmit={event=>{event.preventDefault();void addEquipmentBlock(event.currentTarget);}}>
          <label><span>Апарат</span><select name="equipmentId" required>{equipment.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Дата</span><input name="blockedDate" type="date" min={today} required/></label>
          <label><span>Початок</span><input name="startTime" type="time" min="08:00" max="16:45" required/></label>
          <label><span>Кінець</span><input name="endTime" type="time" min="08:15" max="17:00" required/></label>
          <label className="wide"><span>Причина</span><input name="reason" maxLength={240} placeholder="Технічне обслуговування, санітарна перерва…"/></label>
          <button type="submit">Заблокувати період</button>
        </form>
        <div className="equipmentBlocks">
          {blocks.length === 0 ? <p>Запланованих простоїв немає.</p> : blocks.map(block=><article key={block.id}>
            <div><b>{equipment.find(item=>item.id===block.equipmentId)?.name || block.equipmentId}</b><span>{block.blockedDate} · {block.startTime}–{block.endTime}</span><small>{block.reason || "Без примітки"}</small></div>
            <button type="button" onClick={()=>void removeEquipmentBlock(block.id)}>Видалити</button>
          </article>)}
        </div>
      </section>}

      <section className="bookingList" id="bookings">
        {visible.length === 0 ? <div className="apptEmpty"><span className="apptEmptyIcon" aria-hidden="true">🗓</span><b>Записів немає</b><p>На обрані фільтри записів не знайдено. Змініть дату, статус або пошук.</p></div> :
        groupedByDay.map(([groupDate, rows]) => <div className="apptDay" key={groupDate || "nodate"}>
        <div className="apptDayHead"><b>{formatApptDay(groupDate)}</b><span>{rows.length} {pluralAppt(rows.length)}</span></div>
        {rows.map(item => <article className="bookingRow appointmentRow" key={item.id}>
          <div className="bookingPrimary"><span className={`statusTag ${item.status}`}>{labels[item.status] || item.status}</span><b>{item.name}</b><small>{item.code} · отримано {new Date(item.createdAt).toLocaleString("uk-UA")}</small></div>
          <div><small>Дослідження</small><b>{item.service}</b><span>Код {item.serviceCode} · {equipment.find(unit=>unit.id===item.equipmentId)?.name || item.equipmentId} · {item.durationMinutes} хв</span><span>{item.desiredDate} · {item.desiredTime}</span></div>
          <div><small>Контакт і маршрут</small><a href={`tel:${item.phone}`}>{item.phone}</a><a className="crmCardLink" href={`/staff/patients?phone=${encodeURIComponent(item.phone)}`}>Картка пацієнта →</a><span>{categoryLabels[item.patientCategory] || item.patientCategory}</span><span>{referralLabels[item.referralType] || item.referral}</span>{item.referralNumber&&<span>№ {item.referralNumber}</span>}{item.marketingSource&&<span>Джерело: {item.marketingSource}</span>}</div>
          <div className="bookingAction"><small>Статус</small>
            {canManage?<select value={item.status} onChange={e=>void changeStatus(item.id,e.target.value)}>{Object.entries(labels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>:<b>{labels[item.status] || item.status}</b>}
            {canManage && (item.status==="new"||item.status==="rescheduled") && <button type="button" className="confirmBooking" onClick={()=>void confirmBooking(item.id)}>✓ Підтвердити й у розклад</button>}
            {(() => { const last = notifications.find(note=>note.bookingId===item.id); return last ? <span className={`reminderTag ${last.status}`}>Нагадування: {notificationStatusLabels[last.status]||last.status} · {notificationChannelLabels[last.channel]||last.channel}{last.status==="failed"&&last.error?` — ${last.error}`:""}</span> : null; })()}
          </div>
          <details className="apptManage">
            <summary>Керування записом · {item.performedAt ? "виконано" : "очікує виконання"} · протокол: {protocolLabels[item.protocolStatus] || item.protocolStatus} · оплата: {paymentLabels[item.paymentStatus] || item.paymentStatus}</summary>
          {canManage && <RescheduleForm item={item} today={today} onSubmit={(newDate,newTime)=>reschedule(item.id,newDate,newTime)}/>}
          {item.comment && <p className="bookingComment">{item.comment}</p>}
          <form className="staffNoteForm" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void saveNote(item.id,String(data.get("note")));}}>
            <label><small>Внутрішня нотатка персоналу</small><textarea name="note" maxLength={1200} defaultValue={notes.find(note=>note.bookingId===item.id)?.note||""} placeholder="Підготовка, уточнення направлення, домовленості…"/></label>
            <button type="submit">Зберегти нотатку</button>
            {notes.find(note=>note.bookingId===item.id)&&<span>Оновлено: {new Date(notes.find(note=>note.bookingId===item.id)!.updatedAt).toLocaleString("uk-UA")}</span>}
          </form>
            <div className="operationsGrid">
              <section>
                <h3>Призначені виконавці</h3>
                {canManage ? <form onSubmit={event=>{
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void saveOperations(item.id,{
                    assignedRadiologistEmail:String(data.get("assignedRadiologistEmail")),
                    assignedRadiographerEmail:String(data.get("assignedRadiographerEmail")),
                  },"Лікаря та рентгенолаборанта призначено.");
                }}>
                  <label><span>Лікар-рентгенолог</span><select name="assignedRadiologistEmail" defaultValue={item.assignedRadiologistEmail}>
                    <option value="">Не призначено</option>
                    {staffOptions.filter(member=>member.role==="radiologist").map(member=><option value={member.email} key={member.email}>{member.displayName || member.email}</option>)}
                  </select></label>
                  <label><span>Рентгенолаборант</span><select name="assignedRadiographerEmail" defaultValue={item.assignedRadiographerEmail}>
                    <option value="">Не призначено</option>
                    {staffOptions.filter(member=>member.role==="radiographer").map(member=><option value={member.email} key={member.email}>{member.displayName || member.email}</option>)}
                  </select></label>
                  <button type="submit">Зберегти виконавців</button>
                </form> : <dl className="operationReadOnly">
                  <div><dt>Лікар</dt><dd>{staffOptions.find(member=>member.email===item.assignedRadiologistEmail)?.displayName || item.assignedRadiologistEmail || "Не призначено"}</dd></div>
                  <div><dt>Лаборант</dt><dd>{staffOptions.find(member=>member.email===item.assignedRadiographerEmail)?.displayName || item.assignedRadiographerEmail || "Не призначено"}</dd></div>
                </dl>}
              </section>
              <section>
                <h3>Фактичне виконання</h3>
                <form onSubmit={event=>{
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void saveOperations(item.id,{
                    performedAt:String(data.get("performedAt")),
                    anatomicalRegionsCount:Number(data.get("anatomicalRegionsCount")),
                    externalReference:String(data.get("externalReference")),
                  },"Фактичне виконання дослідження зафіксовано.");
                }}>
                  <label><span>Дата й час виконання</span><input name="performedAt" type="datetime-local" defaultValue={item.performedAt}/></label>
                  <label><span>Анатомічних ділянок</span><input name="anatomicalRegionsCount" type="number" min="1" max="20" step="1" defaultValue={item.anatomicalRegionsCount || 1}/></label>
                  <label><span>№ зовнішнього документа</span><input name="externalReference" maxLength={120} defaultValue={item.externalReference} placeholder="За наявності"/></label>
                  <button type="submit">Зафіксувати виконання</button>
                </form>
              </section>
              <section>
                <h3>Протокол дослідження</h3>
                <a className="protocolBuilderLink" href={`/staff/protocols?open=${item.id}`}>Відкрити конструктор протоколу →</a>
                <a className="protocolBuilderLink" href={`/staff/imaging?open=${item.id}`}>Знімки DICOM →</a>
                {canProtocol ? <form onSubmit={event=>{
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void saveOperations(item.id,{
                    protocolNumber:String(data.get("protocolNumber")),
                    protocolStatus:String(data.get("protocolStatus")),
                  },"Дані протоколу збережено.");
                }}>
                  <label><span>Номер протоколу</span><input name="protocolNumber" maxLength={80} defaultValue={item.protocolNumber} placeholder="Наприклад, КТ-2026-001"/></label>
                  <label><span>Статус</span><select name="protocolStatus" defaultValue={item.protocolStatus}>{Object.entries(protocolLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
                  <button type="submit">Зберегти протокол</button>
                  {(item.protocolReadyAt || item.protocolIssuedAt) && <p className="operationDates">
                    {item.protocolReadyAt && <span>Готовий: {new Date(item.protocolReadyAt).toLocaleString("uk-UA")}</span>}
                    {item.protocolIssuedAt && <span>Видано: {new Date(item.protocolIssuedAt).toLocaleString("uk-UA")}</span>}
                  </p>}
                </form> : <dl className="operationReadOnly">
                  <div><dt>Номер</dt><dd>{item.protocolNumber || "Не присвоєно"}</dd></div>
                  <div><dt>Статус</dt><dd>{protocolLabels[item.protocolStatus] || item.protocolStatus}</dd></div>
                  <div><dt>Готовий</dt><dd>{item.protocolReadyAt ? new Date(item.protocolReadyAt).toLocaleString("uk-UA") : "—"}</dd></div>
                  <div><dt>Видано</dt><dd>{item.protocolIssuedAt ? new Date(item.protocolIssuedAt).toLocaleString("uk-UA") : "—"}</dd></div>
                </dl>}
              </section>
              <section>
                <h3>Оплата та НСЗУ</h3>
                {canFinance ? <form onSubmit={event=>{
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void saveOperations(item.id,{
                    paymentStatus:String(data.get("paymentStatus")),
                    paymentAmount:Number(data.get("paymentAmount")),
                    paidAmount:Number(data.get("paidAmount")),
                    paymentMethod:String(data.get("paymentMethod")),
                    nszuStatus:String(data.get("nszuStatus")),
                    nszuReference:String(data.get("nszuReference")),
                  },"Дані оплати та НСЗУ збережено.");
                }}>
                  <label><span>Статус оплати</span><select name="paymentStatus" defaultValue={item.paymentStatus}>{Object.entries(paymentLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
                  <label><span>Сума до сплати, грн</span><input name="paymentAmount" type="number" min="0" max="100000" step="1" defaultValue={item.paymentAmount || item.listedPrice}/></label>
                  <label><span>Фактично сплачено, грн</span><input name="paidAmount" type="number" min="0" max="100000" step="1" defaultValue={item.paidAmount}/></label>
                  <label><span>Спосіб</span><select name="paymentMethod" defaultValue={item.paymentMethod}>{Object.entries(paymentMethodLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
                  <label><span>Статус НСЗУ</span><select name="nszuStatus" defaultValue={item.nszuStatus}>{Object.entries(nszuLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
                  <label><span>Номер підтвердження НСЗУ</span><input name="nszuReference" maxLength={80} defaultValue={item.nszuReference}/></label>
                  <button type="submit">Зберегти оплату / НСЗУ</button>
                </form> : <dl className="operationReadOnly">
                  <div><dt>Оплата</dt><dd>{paymentLabels[item.paymentStatus] || item.paymentStatus}</dd></div>
                  <div><dt>До сплати</dt><dd>{item.paymentAmount || item.listedPrice} грн</dd></div>
                  <div><dt>Сплачено</dt><dd>{item.paidAmount} грн</dd></div>
                  <div><dt>НСЗУ</dt><dd>{nszuLabels[item.nszuStatus] || item.nszuStatus}</dd></div>
                </dl>}
              </section>
            </div>
            <p className="operationsNote">Це внутрішній облік. Фактичне списання коштів або перевірка в ЕСОЗ/НСЗУ відбуваються лише після підключення офіційного провайдера.</p>
          <details className="bookingHistory">
            <summary>Історія змін ({events.filter(event=>event.bookingId===item.id).length})</summary>
            {events.filter(event=>event.bookingId===item.id).length===0?<p>Змін ще не зафіксовано.</p>:
              <ol>{events.filter(event=>event.bookingId===item.id).map(event=><li key={event.id}><b>{eventLabels[event.action] || event.action}</b><span>{event.details}</span><small>{new Date(event.createdAt).toLocaleString("uk-UA")} · {event.actor==="patient"?"пацієнт":event.actor}</small></li>)}</ol>}
          </details>
          </details>
        </article>)}
        </div>)}
      </section>
    </>}
  </StaffWorkspaceShell>;
}
