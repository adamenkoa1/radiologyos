"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import BookingDrawer from "../booking-drawer";
import { type CalBooking } from "../week-calendar";
import {
  CHANNEL_LABELS,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  DIRECTION_LABELS,
  type PatientSegment,
  type PatientSummary,
  SEGMENT_LABELS,
  matchesSegment,
  segmentCounts,
} from "../../../lib/patients";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };
type PatientProfile = {
  patientId:string; phoneNormalized:string; displayName:string; birthYear:number;
  birthDate:string; email:string; address:string;
  tags:string; notes:string; doNotContact:number; updatedBy:string; updatedAt:string;
};
type PatientBooking = {
  id:number; code:string; service:string; serviceCode:string; equipmentId:string;
  desiredDate:string; desiredTime:string; status:string; patientCategory:string;
  protocolStatus:string; protocolNumber:string; paymentStatus:string;
  paymentAmount:number; paidAmount:number; performedAt:string;
};
type Communication = { id:number; patientId?:string; channel:string; direction:string; summary:string; actor:string; createdAt:string };
type PatientCard = {
  patient:PatientSummary | null; patientId:string; phone:string; profile:PatientProfile | null;
  bookings:PatientBooking[]; communications:Communication[];
};

const roleLabels: Record<StaffRole,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};
const statusLabels: Record<string,string> = {
  new:"Нова", confirmed:"Підтверджена", rescheduled:"Перенесена", completed:"Завершена", cancelled:"Скасована",
};
const protocolLabels: Record<string,string> = {
  not_started:"Не розпочато", in_progress:"В роботі", ready:"Готовий", issued:"Видано",
};
const paymentLabels: Record<string,string> = {
  not_set:"Не визначено", verification_required:"Потрібна перевірка пільги", pending:"Очікує оплати", paid:"Оплачено", not_required:"Не потрібна", refunded:"Повернено",
};
const categoryLabels: Record<string,string> = { civilian:"Цивільний", military:"Військовий" };

function formatDate(value:string) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") || value.includes(" ") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("uk-UA");
}
function formatDateTime(value:string) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") || value.includes(" ") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("uk-UA");
}
function displayPhone(phone:string) {
  return /^380\d{9}$/.test(phone) ? `+${phone.slice(0,3)} ${phone.slice(3,5)} ${phone.slice(5,8)} ${phone.slice(8,10)} ${phone.slice(10)}` : phone;
}
function parseTags(tags:string) {
  return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
}
function patientKey(patientId:string, phone:string) {
  return patientId ? `patient:${patientId}` : `legacy:${phone}`;
}

export default function PatientsPage() {
  const [patients,setPatients] = useState<PatientSummary[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [segment,setSegment] = useState<PatientSegment>("all");
  const [query,setQuery] = useState("");
  const [selectedPatientKey,setSelectedPatientKey] = useState<string | null>(null);
  const [card,setCard] = useState<PatientCard | null>(null);
  const [cardLoading,setCardLoading] = useState(false);
  const [creating,setCreating] = useState(false);
  const [error,setError] = useState("");
  const [actionError,setActionError] = useState("");
  const [actionSuccess,setActionSuccess] = useState("");
  const [saving,setSaving] = useState(false);

  async function loadList() {
    const response = await fetch("/api/staff/patients", { cache:"no-store" });
    const data = await response.json() as { patients?:PatientSummary[]; staff?:StaffInfo; error?:string };
    if (!response.ok) { setError(data.error || "Немає доступу"); return; }
    setPatients(data.patients || []);
    setStaff(data.staff || null);
    setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!patients.length || selectedPatientKey !== null) return;
    const params = new URLSearchParams(window.location.search);
    const requestedPatientId = (params.get("patientId") || "").trim().toLowerCase();
    if (requestedPatientId) {
      const exact = patients.find((item) => item.patientId === requestedPatientId);
      if (exact) void openPatient(exact);
      return;
    }
    const requestedPhone = params.get("phone");
    if (!requestedPhone) return;
    const digits = requestedPhone.replace(/\D/g, "");
    const matches = patients.filter((item) => item.phoneNormalized === digits || item.phoneNormalized.endsWith(digits.slice(-9)));
    if (matches.length === 1) void openPatient(matches[0]);
    if (matches.length > 1) {
      const timer = window.setTimeout(() => {
        setActionError("Цей номер телефону належить кільком карткам. Оберіть конкретного пацієнта зі списку.");
      }, 0);
      return () => window.clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients]);

  async function openPatient(item:{ patientId:string; phoneNormalized:string }) {
    const key = patientKey(item.patientId, item.phoneNormalized);
    setActionError(""); setActionSuccess(""); setCreating(false); setSelectedPatientKey(key); setCard(null); setCardLoading(true);
    try {
      const query = item.patientId
        ? `patientId=${encodeURIComponent(item.patientId)}`
        : `phone=${encodeURIComponent(item.phoneNormalized)}`;
      const response = await fetch(`/api/staff/patients?${query}`, { cache:"no-store" });
      const data = await response.json() as PatientCard & { error?:string };
      if (!response.ok) { setActionError(data.error || "Не вдалося відкрити картку"); return; }
      setCard(data);
    } catch {
      setActionError("Помилка мережі — спробуйте ще раз");
    } finally {
      setCardLoading(false);
    }
  }

  async function refreshCard() {
    if (!card) return;
    await openPatient({ patientId:card.patientId || "", phoneNormalized:card.phone });
  }

  async function saveProfile(form:HTMLFormElement) {
    if (!card) return;
    setActionError(""); setActionSuccess(""); setSaving(true);
    const data = new FormData(form);
    const response = await fetch("/api/staff/patients", {
      method:"PUT", headers:{"content-type":"application/json"},
      body:JSON.stringify({
        patientId:card.patientId || undefined,
        phone:card.phone,
        displayName:String(data.get("displayName") || ""),
        birthDate:String(data.get("birthDate") || ""),
        email:String(data.get("email") || ""),
        address:String(data.get("address") || ""),
        tags:String(data.get("tags") || ""),
        notes:String(data.get("notes") || ""),
        doNotContact:data.get("doNotContact") === "on",
      }),
    });
    const result = await response.json() as { ok?:boolean; profile?:PatientProfile; error?:string };
    setSaving(false);
    if (!response.ok || !result.ok || !result.profile) { setActionError(result.error || "Не вдалося зберегти картку"); return; }
    await loadList();
    await openPatient({ patientId:result.profile.patientId, phoneNormalized:result.profile.phoneNormalized });
    setActionSuccess("Картку пацієнта збережено.");
  }

  async function createPatient(form:HTMLFormElement) {
    setActionError(""); setActionSuccess(""); setSaving(true);
    const data = new FormData(form);
    const response = await fetch("/api/staff/patients", {
      method:"PUT", headers:{"content-type":"application/json"},
      body:JSON.stringify({
        phone:String(data.get("phone") || ""),
        displayName:String(data.get("displayName") || ""),
        birthDate:String(data.get("birthDate") || ""),
        email:String(data.get("email") || ""),
        address:String(data.get("address") || ""),
        tags:String(data.get("tags") || ""),
        notes:String(data.get("notes") || ""),
        doNotContact:data.get("doNotContact") === "on",
      }),
    });
    const result = await response.json() as { ok?:boolean; profile?:PatientProfile; error?:string };
    setSaving(false);
    if (!response.ok || !result.ok || !result.profile) { setActionError(result.error || "Не вдалося додати пацієнта"); return; }
    setCreating(false);
    await loadList();
    setActionSuccess("Пацієнта додано.");
    void openPatient({ patientId:result.profile.patientId, phoneNormalized:result.profile.phoneNormalized });
  }

  async function logCommunication(form:HTMLFormElement) {
    if (!card) return;
    setActionError(""); setActionSuccess(""); setSaving(true);
    const data = new FormData(form);
    const response = await fetch("/api/staff/patients", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({
        patientId:card.patientId || undefined,
        phone:card.phone,
        channel:String(data.get("channel")),
        direction:String(data.get("direction")),
        summary:String(data.get("summary")),
      }),
    });
    const result = await response.json() as { ok?:boolean; communication?:Communication; error?:string };
    setSaving(false);
    if (!response.ok || !result.ok || !result.communication) { setActionError(result.error || "Не вдалося зберегти звернення"); return; }
    const entry = { ...result.communication, createdAt:new Date().toISOString() };
    form.reset();
    setCard((current) => current && ({ ...current, communications:[entry, ...current.communications] }));
    setActionSuccess("Звернення додано до історії комунікацій.");
  }

  const canManage = staff?.role === "admin" || staff?.role === "registrar";

  const [openId,setOpenId] = useState<number | null>(null);
  const [drawerBusy,setDrawerBusy] = useState<number | null>(null);
  const drawerBookings = useMemo<CalBooking[]>(() => (card?.bookings || []).map((v) => ({
    id:v.id, code:v.code, name:card?.profile?.displayName || card?.patient?.name || "", phone:card?.phone || "",
    service:v.service, serviceCode:v.serviceCode, equipmentId:v.equipmentId, durationMinutes:30,
    desiredDate:v.desiredDate, desiredTime:v.desiredTime, status:v.status,
    patientCategory:card?.patient?.category, paymentStatus:v.paymentStatus, paymentAmount:v.paymentAmount,
  })), [card]);
  const openBooking = drawerBookings.find((b) => b.id === openId) || null;

  async function drawerPatch(body:Record<string,unknown>) {
    const id = body.id as number;
    setDrawerBusy(id);
    try {
      const res = await fetch("/api/staff/bookings", { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify(body) });
      if (res.ok && card) await refreshCard();
      else { const d = await res.json().catch(()=>({})) as { error?:string }; setActionError(d.error || "Не вдалося виконати дію"); }
    } finally { setDrawerBusy(null); }
  }

  const counts = useMemo(() => segmentCounts(patients), [patients]);
  const visible = useMemo(() => patients
    .filter((item) => matchesSegment(item, segment))
    .filter((item) => !query.trim() || `${item.name} ${item.phoneNormalized} ${item.tags}`.toLowerCase().includes(query.trim().toLowerCase())),
  [patients,segment,query]);

  return <StaffWorkspaceShell
    active="patients"
    title="Картки пацієнтів (CRM)"
    description="Єдина історія звернень пацієнта: візити, протоколи, оплати, комунікації та сегменти для роботи реєстратури."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fpatients">Увійти для роботи</a></section> :
    <div className="protocolWorkspace">
      <aside className="protocolQueue" aria-label="Список пацієнтів">
        <div className="protocolQueueTools">
          <div className="crmSegmentTabs" role="tablist">
            {(Object.keys(SEGMENT_LABELS) as PatientSegment[]).map((key)=><button
              key={key} role="tab" aria-selected={segment===key}
              className={segment===key?"active":""} onClick={()=>setSegment(key)}
            >{SEGMENT_LABELS[key]} <b>{counts[key]}</b></button>)}
          </div>
          <input type="search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="ПІБ, телефон, тег"/>
          {canManage && <button type="button" className="crmAddBtn" onClick={()=>{setCreating(true);setSelectedPatientKey(null);setCard(null);setActionError("");setActionSuccess("");}}>+ Додати пацієнта</button>}
          <a className="crmExport" href="/api/staff/patients/export" download title="Завантажити CSV для імпорту в Google Контакти">↧ Експорт у Google Контакти</a>
          {canManage && <a className="crmExport" href="/staff/patients/import" title="Імпорт пацієнтів із CSV">↥ Імпорт із CSV</a>}
        </div>
        <div className="protocolQueueList">
          {visible.length === 0 ? <p className="empty">Пацієнтів у цій категорії немає.</p> : visible.map((item)=>{
            const key = patientKey(item.patientId, item.phoneNormalized);
            return <button
              key={key}
              className={`protocolQueueItem${selectedPatientKey===key?" active":""}`}
              onClick={()=>void openPatient(item)}
            >
              <span className="crmItemTop">
                <span className={`protocolTag ${item.upcoming?"in_progress":item.completed?"issued":""}`}>{item.visits} візит{item.visits===1?"":item.visits<5?"и":"ів"}</span>
                {item.doNotContact && <span className="crmDnc">Не турбувати</span>}
              </span>
              <b>{item.name || "Без імені"}</b>
              <small>{displayPhone(item.phoneNormalized)} · {categoryLabels[item.category] || item.category}{item.patientId ? "" : " · legacy"}</small>
              <small>Останній візит: {formatDate(item.lastVisit)}{item.dueTotal>0?` · борг ${item.dueTotal} грн`:""}</small>
            </button>;
          })}
        </div>
      </aside>

      <section className="protocolEditor">
        {actionError && <p className="staffError" role="alert">{actionError}</p>}
        {actionSuccess && <p className="staffSuccess" role="status">{actionSuccess}</p>}

        {creating ? <div className="crmCreate">
          <header className="protocolEditorHead"><div><p className="eyebrow">Новий пацієнт</p><h2>Картка пацієнта</h2><p>Створіть картку вручну. Обовʼязкові — імʼя та телефон. Один номер може використовуватися кількома пацієнтами.</p></div></header>
          <form className="crmCreateForm" onSubmit={(e)=>{e.preventDefault();void createPatient(e.currentTarget);}}>
            <label><span>ПІБ *</span><input name="displayName" maxLength={120} required placeholder="Прізвище Імʼя По батькові"/></label>
            <label><span>Телефон *</span><input name="phone" required inputMode="tel" placeholder="+380 97 000 00 00"/></label>
            <label><span>Дата народження</span><input name="birthDate" type="date" max="2100-12-31" min="1900-01-01"/></label>
            <label><span>Email</span><input name="email" type="email" placeholder="name@example.com"/></label>
            <label className="crmWide"><span>Адреса</span><input name="address" maxLength={200} placeholder="Місто, вулиця, будинок"/></label>
            <label><span>Теги (через кому)</span><input name="tags" maxLength={200} placeholder="VIP, потребує супроводу"/></label>
            <label className="crmWide"><span>Нотатки</span><textarea name="notes" maxLength={2000} placeholder="Алергії, особливі вказівки, домовленості"/></label>
            <label className="crmCheck"><input name="doNotContact" type="checkbox"/><span>Не турбувати</span></label>
            <div className="crmCreateActions">
              <button type="submit" disabled={saving}>{saving?"Зберігаємо…":"Додати пацієнта"}</button>
              <button type="button" className="crmCancel" onClick={()=>setCreating(false)}>Скасувати</button>
            </div>
          </form>
        </div> : cardLoading && !card ? <div className="protocolPlaceholder">
          <span aria-hidden="true">⏳</span>
          <b>Завантаження картки…</b>
          <p>Збираємо історію візитів, протоколів, оплат і комунікацій пацієнта.</p>
        </div> : !card || !selectedPatientKey ? <div className="protocolPlaceholder">
          <span aria-hidden="true">☺</span>
          <b>Оберіть пацієнта зі списку</b>
          <p>Картка з історією візитів, протоколів, оплат і комунікацій відкриється тут. Або натисніть «Додати пацієнта», щоб створити картку вручну.</p>
        </div> : <>
          <header className="protocolEditorHead">
            <div>
              <p className="eyebrow">CRM · {card.patient?.visits || card.bookings.length} візит(и){card.profile?.birthDate ? ` · нар. ${formatDate(card.profile.birthDate)}` : card.profile?.birthYear ? ` · ${card.profile.birthYear} р.н.` : ""}{card.patientId ? "" : " · legacy"}</p>
              <h2>{card.profile?.displayName || card.patient?.name || "Без імені"}</h2>
              <p><a href={`tel:${card.phone}`}>{displayPhone(card.phone)}</a>{card.patient?.category ? ` · ${categoryLabels[card.patient.category] || card.patient.category}` : ""}</p>
              {(card.profile?.email || card.profile?.address) && <p className="crmContactLine">{card.profile?.email}{card.profile?.email && card.profile?.address ? " · " : ""}{card.profile?.address}</p>}
              {(card.profile?.tags || card.patient?.marketingSource) && <p className="crmTagRow">
                {parseTags(card.profile?.tags || "").map((tag)=><span className="crmTag" key={tag}>{tag}</span>)}
                {card.patient?.marketingSource && <span className="crmTag muted">Джерело: {card.patient.marketingSource}</span>}
              </p>}
            </div>
            <div className="crmCardActions">
              {card.profile?.doNotContact ? <span className="crmDnc large">Не турбувати</span> : null}
              {canManage && <a className="crmBookBtn" href={`/staff/book?${new URLSearchParams({
                ...(card.patientId ? { patientId:card.patientId } : {}),
                phone:card.phone,
                name:card.profile?.displayName || card.patient?.name || "",
                dob:card.profile?.birthDate || "",
                category:card.patient?.category || "",
              }).toString()}`}>+ Записати на дослідження</a>}
            </div>
          </header>

          <div className="crmStats">
            <article><span>Візитів</span><b>{card.patient?.visits || 0}</b></article>
            <article><span>Завершено</span><b>{card.patient?.completed || 0}</b></article>
            <article><span>Очікують протокол</span><b>{card.patient?.awaitingProtocol || 0}</b></article>
            <article><span>Борг, грн</span><b>{card.patient?.dueTotal || 0}</b></article>
            <article><span>Сплачено, грн</span><b>{card.patient?.paidTotal || 0}</b></article>
          </div>

          {canManage && <details className="crmProfile" open={!card.profile}>
            <summary>{card.profile ? "Дані картки пацієнта" : "Створити exact-картку для legacy запису"}</summary>
            <form onSubmit={(e)=>{e.preventDefault();void saveProfile(e.currentTarget);}}>
              <label><span>ПІБ</span><input name="displayName" maxLength={120} defaultValue={card.profile?.displayName || card.patient?.name || ""}/></label>
              <label><span>Дата народження</span><input name="birthDate" type="date" max="2100-12-31" min="1900-01-01" defaultValue={card.profile?.birthDate || ""}/></label>
              <label><span>Email</span><input name="email" type="email" defaultValue={card.profile?.email || ""} placeholder="name@example.com"/></label>
              <label className="crmWide"><span>Адреса</span><input name="address" maxLength={200} defaultValue={card.profile?.address || ""} placeholder="Місто, вулиця, будинок"/></label>
              <label><span>Теги (через кому)</span><input name="tags" maxLength={200} defaultValue={card.profile?.tags || ""} placeholder="VIP, потребує супроводу"/></label>
              <label className="crmWide"><span>Нотатки</span><textarea name="notes" maxLength={2000} defaultValue={card.profile?.notes || ""} placeholder="Особливості, алергії, домовленості"/></label>
              <label className="crmCheck"><input name="doNotContact" type="checkbox" defaultChecked={!!card.profile?.doNotContact}/><span>Не турбувати (пацієнт відмовився від дзвінків/розсилок)</span></label>
              <button type="submit" disabled={saving}>{card.profile ? "Зберегти картку" : "Створити окрему картку"}</button>
            </form>
          </details>}

          <div className="crmColumns">
            <section className="crmVisits">
              <h3>Історія візитів</h3>
              {card.bookings.length === 0 ? <p className="empty">Візитів ще немає.</p> : <ol>
                {card.bookings.map((booking)=><li key={booking.id}>
                  <button type="button" className="crmVisitHead" onClick={()=>setOpenId(booking.id)} title="Швидкий перегляд у панелі">
                    <span className={`statusTag ${booking.status}`}>{statusLabels[booking.status] || booking.status}</span>
                    <b>{booking.service}</b>
                    <small>{booking.code} · {formatDate(booking.desiredDate)} {booking.desiredTime}</small>
                  </button>
                  <div className="crmVisitMeta">
                    <span>Протокол: {protocolLabels[booking.protocolStatus] || booking.protocolStatus}{booking.protocolNumber?` (№ ${booking.protocolNumber})`:""}</span>
                    <span>Оплата: {paymentLabels[booking.paymentStatus] || booking.paymentStatus}{booking.paidAmount?` · ${booking.paidAmount} грн`:""}</span>
                    {booking.performedAt && <span>Виконано: {formatDateTime(booking.performedAt)}</span>}
                  </div>
                  {booking.performedAt || ["ready","issued","in_progress"].includes(booking.protocolStatus)
                    ? <a className="crmVisitLink" href={`/staff/protocols?open=${booking.id}`}>Протокол дослідження →</a>
                    : <a className="crmVisitLink" href={`/staff/appointments?date=${booking.desiredDate}&view=day`}>Відкрити в календарі →</a>}
                </li>)}
              </ol>}
            </section>

            <section className="crmComms">
              <h3>Комунікації</h3>
              <form className="crmCommForm" onSubmit={(e)=>{e.preventDefault();void logCommunication(e.currentTarget);}}>
                <div className="crmCommRow">
                  <label><span>Канал</span><select name="channel" defaultValue="call">{COMMUNICATION_CHANNELS.map((channel)=><option key={channel} value={channel}>{CHANNEL_LABELS[channel]}</option>)}</select></label>
                  <label><span>Напрям</span><select name="direction" defaultValue="outbound">{COMMUNICATION_DIRECTIONS.map((direction)=><option key={direction} value={direction}>{DIRECTION_LABELS[direction]}</option>)}</select></label>
                </div>
                <label><span>Зміст звернення</span><textarea name="summary" maxLength={1000} required placeholder="Нагадування про візит, уточнення підготовки, результат дзвінка…"/></label>
                <button type="submit" disabled={saving}>Додати звернення</button>
              </form>
              {card.communications.length === 0 ? <p className="empty">Звернень ще не зафіксовано.</p> : <ol className="crmCommList">
                {card.communications.map((entry)=><li key={entry.id}>
                  <div><span className={`crmCommTag ${entry.direction}`}>{DIRECTION_LABELS[entry.direction] || entry.direction}</span><b>{CHANNEL_LABELS[entry.channel] || entry.channel}</b></div>
                  <p>{entry.summary}</p>
                  <small>{formatDateTime(entry.createdAt)} · {entry.actor}</small>
                </li>)}
              </ol>}
            </section>
          </div>
        </>}
      </section>
      {openBooking && <BookingDrawer
        key={openBooking.id}
        booking={openBooking}
        all={drawerBookings}
        patientHref={card?.patientId ? `/staff/patients?patientId=${encodeURIComponent(card.patientId)}` : ""}
        historyScoped
        onClose={()=>setOpenId(null)}
        onOpen={setOpenId}
        onConfirm={canManage ? (id)=>void drawerPatch({ id, confirm:true }) : undefined}
        confirming={drawerBusy===openBooking.id}
        onReschedule={canManage ? (id,date,time)=>void drawerPatch({ id, desiredDate:date, desiredTime:time }) : undefined}
        rescheduling={drawerBusy===openBooking.id}
      />}
    </div>}
  </StaffWorkspaceShell>;
}
