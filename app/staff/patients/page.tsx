"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
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
  phoneNormalized:string; displayName:string; birthYear:number;
  tags:string; notes:string; doNotContact:number; updatedBy:string; updatedAt:string;
};
type PatientBooking = {
  id:number; code:string; service:string; serviceCode:string; equipmentId:string;
  desiredDate:string; desiredTime:string; status:string; patientCategory:string;
  protocolStatus:string; protocolNumber:string; paymentStatus:string;
  paymentAmount:number; paidAmount:number; performedAt:string;
};
type Communication = { id:number; channel:string; direction:string; summary:string; actor:string; createdAt:string };
type PatientCard = {
  patient:PatientSummary | null; phone:string; profile:PatientProfile | null;
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
  not_set:"Не визначено", pending:"Очікує оплати", paid:"Оплачено", not_required:"Не потрібна", refunded:"Повернено",
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

export default function PatientsPage() {
  const [patients,setPatients] = useState<PatientSummary[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [segment,setSegment] = useState<PatientSegment>("all");
  const [query,setQuery] = useState("");
  const [selectedPhone,setSelectedPhone] = useState<string | null>(null);
  const [card,setCard] = useState<PatientCard | null>(null);
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
    if (!patients.length || selectedPhone !== null) return;
    const requested = new URLSearchParams(window.location.search).get("phone");
    if (!requested) return;
    const digits = requested.replace(/\D/g, "");
    const match = patients.find((item) => item.phoneNormalized === digits || item.phoneNormalized.endsWith(digits.slice(-9)));
    if (match) void openPatient(match.phoneNormalized);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients]);

  async function openPatient(phone:string) {
    setActionError(""); setActionSuccess(""); setSelectedPhone(phone); setCard(null);
    const response = await fetch(`/api/staff/patients?phone=${encodeURIComponent(phone)}`, { cache:"no-store" });
    const data = await response.json() as PatientCard & { error?:string };
    if (!response.ok) { setActionError(data.error || "Не вдалося відкрити картку"); return; }
    setCard(data);
  }

  async function saveProfile(form:HTMLFormElement) {
    if (!card) return;
    setActionError(""); setActionSuccess(""); setSaving(true);
    const data = new FormData(form);
    const response = await fetch("/api/staff/patients", {
      method:"PUT", headers:{"content-type":"application/json"},
      body:JSON.stringify({
        phone:card.phone,
        displayName:String(data.get("displayName") || ""),
        birthYear:Number(data.get("birthYear")) || 0,
        tags:String(data.get("tags") || ""),
        notes:String(data.get("notes") || ""),
        doNotContact:data.get("doNotContact") === "on",
      }),
    });
    const result = await response.json() as { ok?:boolean; profile?:PatientProfile; error?:string };
    setSaving(false);
    if (!response.ok || !result.ok) { setActionError(result.error || "Не вдалося зберегти картку"); return; }
    const profile = { ...(result.profile as PatientProfile), phoneNormalized:card.phone, updatedAt:new Date().toISOString() };
    setCard((current) => current && ({ ...current, profile }));
    setPatients((current) => current.map((item) => item.phoneNormalized === card.phone ? {
      ...item, name:profile.displayName || item.name, tags:profile.tags, doNotContact:!!profile.doNotContact, hasProfile:true,
    } : item));
    setActionSuccess("Картку пацієнта збережено.");
  }

  async function logCommunication(form:HTMLFormElement) {
    if (!card) return;
    setActionError(""); setActionSuccess(""); setSaving(true);
    const data = new FormData(form);
    const response = await fetch("/api/staff/patients", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({
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
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/signin-with-chatgpt?returnTo=%2Fstaff%2Fpatients">Увійти для роботи</a></section> :
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
        </div>
        <div className="protocolQueueList">
          {visible.length === 0 ? <p className="empty">Пацієнтів у цій категорії немає.</p> : visible.map((item)=><button
            key={item.phoneNormalized}
            className={`protocolQueueItem${selectedPhone===item.phoneNormalized?" active":""}`}
            onClick={()=>void openPatient(item.phoneNormalized)}
          >
            <span className="crmItemTop">
              <span className={`protocolTag ${item.upcoming?"in_progress":item.completed?"issued":""}`}>{item.visits} візит{item.visits===1?"":item.visits<5?"и":"ів"}</span>
              {item.doNotContact && <span className="crmDnc">Не турбувати</span>}
            </span>
            <b>{item.name || "Без імені"}</b>
            <small>{displayPhone(item.phoneNormalized)} · {categoryLabels[item.category] || item.category}</small>
            <small>Останній візит: {formatDate(item.lastVisit)}{item.dueTotal>0?` · борг ${item.dueTotal} грн`:""}</small>
          </button>)}
        </div>
      </aside>

      <section className="protocolEditor">
        {actionError && <p className="staffError" role="alert">{actionError}</p>}
        {actionSuccess && <p className="staffSuccess" role="status">{actionSuccess}</p>}

        {!card || !selectedPhone ? <div className="protocolPlaceholder">
          <span aria-hidden="true">☺</span>
          <b>Оберіть пацієнта зі списку</b>
          <p>Картка з історією візитів, протоколів, оплат і комунікацій відкриється тут. Пацієнти формуються за номером телефону із заявок.</p>
        </div> : <>
          <header className="protocolEditorHead">
            <div>
              <p className="eyebrow">CRM · {card.patient?.visits || card.bookings.length} візит(и){card.profile?.birthYear ? ` · ${card.profile.birthYear} р.н.` : ""}</p>
              <h2>{card.profile?.displayName || card.patient?.name || "Без імені"}</h2>
              <p><a href={`tel:${card.phone}`}>{displayPhone(card.phone)}</a> · {categoryLabels[card.patient?.category || ""] || card.patient?.category}</p>
              {(card.profile?.tags || card.patient?.marketingSource) && <p className="crmTagRow">
                {parseTags(card.profile?.tags || "").map((tag)=><span className="crmTag" key={tag}>{tag}</span>)}
                {card.patient?.marketingSource && <span className="crmTag muted">Джерело: {card.patient.marketingSource}</span>}
              </p>}
            </div>
            {card.profile?.doNotContact ? <span className="crmDnc large">Не турбувати</span> : null}
          </header>

          <div className="crmStats">
            <article><span>Візитів</span><b>{card.patient?.visits || 0}</b></article>
            <article><span>Завершено</span><b>{card.patient?.completed || 0}</b></article>
            <article><span>Очікують протокол</span><b>{card.patient?.awaitingProtocol || 0}</b></article>
            <article><span>Борг, грн</span><b>{card.patient?.dueTotal || 0}</b></article>
            <article><span>Сплачено, грн</span><b>{card.patient?.paidTotal || 0}</b></article>
          </div>

          {canManage && <details className="crmProfile" open={!card.profile}>
            <summary>Дані картки пацієнта</summary>
            <form onSubmit={(e)=>{e.preventDefault();void saveProfile(e.currentTarget);}}>
              <label><span>ПІБ</span><input name="displayName" maxLength={120} defaultValue={card.profile?.displayName || card.patient?.name || ""}/></label>
              <label><span>Рік народження</span><input name="birthYear" type="number" min={1900} max={2100} defaultValue={card.profile?.birthYear || ""} placeholder="РРРР"/></label>
              <label><span>Теги (через кому)</span><input name="tags" maxLength={200} defaultValue={card.profile?.tags || ""} placeholder="VIP, потребує супроводу"/></label>
              <label className="crmWide"><span>Нотатки</span><textarea name="notes" maxLength={2000} defaultValue={card.profile?.notes || ""} placeholder="Особливості, алергії, домовленості"/></label>
              <label className="crmCheck"><input name="doNotContact" type="checkbox" defaultChecked={!!card.profile?.doNotContact}/><span>Не турбувати (пацієнт відмовився від дзвінків/розсилок)</span></label>
              <button type="submit" disabled={saving}>Зберегти картку</button>
            </form>
          </details>}

          <div className="crmColumns">
            <section className="crmVisits">
              <h3>Історія візитів</h3>
              {card.bookings.length === 0 ? <p className="empty">Візитів ще немає.</p> : <ol>
                {card.bookings.map((booking)=><li key={booking.id}>
                  <div className="crmVisitHead">
                    <span className={`statusTag ${booking.status}`}>{statusLabels[booking.status] || booking.status}</span>
                    <b>{booking.service}</b>
                    <small>{booking.code} · {formatDate(booking.desiredDate)} {booking.desiredTime}</small>
                  </div>
                  <div className="crmVisitMeta">
                    <span>Протокол: {protocolLabels[booking.protocolStatus] || booking.protocolStatus}{booking.protocolNumber?` (№ ${booking.protocolNumber})`:""}</span>
                    <span>Оплата: {paymentLabels[booking.paymentStatus] || booking.paymentStatus}{booking.paidAmount?` · ${booking.paidAmount} грн`:""}</span>
                    {booking.performedAt && <span>Виконано: {formatDateTime(booking.performedAt)}</span>}
                  </div>
                  <a className="crmVisitLink" href={`/staff/protocols?open=${booking.id}`}>Протокол дослідження →</a>
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
    </div>}
  </StaffWorkspaceShell>;
}
