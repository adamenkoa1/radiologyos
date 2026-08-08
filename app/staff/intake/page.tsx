"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { SERVICES, groupedServices } from "../../../lib/catalog";
import { todayInKyiv } from "../../../lib/booking-rules";

// Дошка прийому заявок: ліворуч — черга вхідних (сайт + вручну), праворуч —
// картка заявки з повним редагуванням (корекція) і діями в одному місці.

type Booking = {
  id:number; code:string; name:string; phone:string; patientEmail?:string;
  service:string; serviceCode:string; equipmentId:string; durationMinutes:number;
  desiredDate:string; desiredTime:string; patientCategory:string; comment:string;
  status:string; createdAt:string; dateOfBirth?:string; paymentStatus?:string;
  referralType?:string; referralNumber?:string; marketingSource?:string;
  paymentAmount?:number; paymentMethod?:string; protocolNumber?:string;
};
type EventRow = { bookingId:number; action:string };
type StaffInfo = { email:string; displayName:string; role:string };
type Data = { bookings:Booking[]; events:EventRow[]; staff:StaffInfo };

const STATUS_LABELS:Record<string,string> = {
  new:"Нова", confirmed:"Підтверджена", rescheduled:"Перенесена",
  arrived:"Прибув", no_show:"Неявка", completed:"Завершена", cancelled:"Скасована",
  queued:"У черзі", in_progress:"Виконується", images_ready:"Є знімки",
  reporting:"Опис", protocol_ready:"Протокол готовий", issued:"Видано", performed:"Виконано",
};
const REFERRAL_UK:Record<string,string> = {
  military_referral:"Військове направлення", eh_referral:"Електронне направлення (ЕЗ)",
  paper_referral:"Паперове направлення", other:"Інше направлення", none:"Без направлення",
};
const EQUIP_UK:Record<string,string> = { ct:"КТ", xray:"Рентген", fluoro:"Флюорограф" };
// Ознаки без окремих полів у БД.
const isContrast = (svc:string) => /контраст|ангіограф/i.test(svc || "");
const digits = (s:string) => (s || "").replace(/[^\d]/g, "");
// Вік із дати народження (роки), Київ не критичний для року.
function ageFrom(dob?:string) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y,m,d] = dob.split("-").map(Number);
  const now = new Date();
  let a = now.getUTCFullYear() - y;
  const mm = now.getUTCMonth()+1;
  if (mm < m || (mm === m && now.getUTCDate() < d)) a--;
  return a >= 0 && a < 130 ? a : null;
}
const serviceGroups = groupedServices();
const emptyForm = { name:"", phone:"", email:"", dob:"", patientCategory:"civilian", serviceCode:SERVICES[0].code, comment:"", date:"", time:"" };
type Form = typeof emptyForm;

export default function IntakePage() {
  const [data, setData] = useState<Data|null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number|null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [times, setTimes] = useState<string[]>([]);
  const [filter, setFilter] = useState<"attention"|"all">("attention");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  function flash(msg:string) { setToast(msg); window.setTimeout(()=>setToast(""), 2600); }

  async function load(keepSelection = true) {
    const res = await fetch("/api/staff/bookings", { cache:"no-store" });
    if (res.status === 401 || res.status === 403) { setForbidden(true); setLoaded(true); return; }
    const payload = await res.json().catch(()=>null) as (Data & { error?:string }) | null;
    // Помилки (503/500 тощо) не кладемо в data — інакше далі впаде data.staff.
    if (!res.ok || !payload || !Array.isArray(payload.bookings) || !payload.staff) {
      flash(payload?.error || "Не вдалося завантажити заявки"); setLoaded(true); return;
    }
    setData(payload); setLoaded(true);
    if (!keepSelection) setSelectedId(null);
  }
  // Одноразове завантаження на монтуванні (load стабільний за задумом).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(t); }, []);

  const sourceOf = useMemo(() => {
    const m = new Map<number,"site"|"staff">();
    for (const ev of data?.events ?? []) {
      if (ev.action === "created_by_staff") m.set(ev.bookingId, "staff");
      else if (ev.action === "created" && !m.has(ev.bookingId)) m.set(ev.bookingId, "site");
    }
    return m;
  }, [data]);

  const selected = data?.bookings.find(b => b.id === selectedId) || null;

  // Попередні дослідження цього пацієнта — за номером телефону (без окремого
  // бекенду: беремо з уже завантаженого списку заявок). Пацієнт як центр.
  const history = useMemo(() => {
    if (!selected) return [] as Booking[];
    const ph = digits(selected.phone);
    if (!ph) return [];
    return (data?.bookings ?? [])
      .filter(b => b.id !== selected.id && digits(b.phone) === ph)
      .sort((a,b) => (b.desiredDate+b.desiredTime).localeCompare(a.desiredDate+a.desiredTime));
  }, [data, selected]);

  // Чи форма розходиться зі збереженою заявкою (лише поля корекції).
  function formMatchesSelected() {
    if (!selected) return true;
    return form.name===(selected.name||"") && form.phone===(selected.phone||"") && form.email===(selected.patientEmail||"")
      && form.dob===(selected.dateOfBirth||"") && form.patientCategory===(selected.patientCategory||"civilian")
      && form.serviceCode===(selected.serviceCode||SERVICES[0].code) && form.comment===(selected.comment||"");
  }
  function guardUnsaved() {
    return !(selected && !creating && !formMatchesSelected()) || window.confirm("Незбережені зміни буде втрачено. Продовжити?");
  }

  // Вибір заявки заповнює форму (режим редагування) — без ефекту, у обробнику.
  function selectBooking(b:Booking) {
    if (!guardUnsaved()) return;
    setCreating(false);
    setSelectedId(b.id);
    setForm({
      name:b.name || "", phone:b.phone || "", email:b.patientEmail || "",
      dob:b.dateOfBirth || "", patientCategory:b.patientCategory || "civilian",
      serviceCode:b.serviceCode || SERVICES[0].code, comment:b.comment || "",
      date:b.desiredDate || "", time:b.desiredTime || "",
    });
  }

  // Вільні слоти для перенесення/нової заявки.
  useEffect(() => {
    const c = new AbortController();
    const t = window.setTimeout(() => {
      if (!form.date || !form.serviceCode) { setTimes([]); return; }
      fetch(`/api/availability?date=${encodeURIComponent(form.date)}&serviceCode=${encodeURIComponent(form.serviceCode)}`, { signal:c.signal, cache:"no-store" })
        .then(r => r.ok ? r.json() : { times:[] }).then(d => setTimes(Array.isArray(d.times) ? d.times : [])).catch(()=>{});
    }, 0);
    return () => { c.abort(); window.clearTimeout(t); };
  }, [form.date, form.serviceCode]);

  const list = useMemo(() => {
    const items = (data?.bookings ?? []).filter(b => filter === "all" ? true : (b.status === "new" || b.status === "rescheduled"));
    const q = query.trim().toLowerCase();
    const matched = q ? items.filter(b => `${b.name} ${b.phone} ${b.code}`.toLowerCase().includes(q)) : items;
    return matched.sort((a,b) => (a.desiredDate+a.desiredTime).localeCompare(b.desiredDate+b.desiredTime));
  }, [data, filter, query]);

  const set = (k:keyof Form) => (e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]:e.target.value }));

  async function patch(bodyExtra:Record<string,unknown>, okMsg:string) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch("/api/staff/bookings", { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({ id:selected.id, ...bodyExtra }) });
      const d = await res.json().catch(()=>({})) as { error?:string };
      if (!res.ok) { flash(d.error || "Помилка"); return; }
      flash(okMsg); await load();
    } finally { setBusy(false); }
  }

  function saveEdits() {
    void patch({ edit:{ name:form.name, phone:form.phone, email:form.email, dob:form.dob, patientCategory:form.patientCategory, serviceCode:form.serviceCode, comment:form.comment } }, "Заявку скориговано");
  }
  function confirmBooking() { void patch({ confirm:true }, "Підтверджено — пацієнту надіслано WhatsApp"); }
  function cancelBooking() { if (window.confirm("Скасувати заявку?")) void patch({ status:"cancelled" }, "Скасовано"); }
  function reschedule() { if (form.date && form.time) void patch({ desiredDate:form.date, desiredTime:form.time }, "Перенесено"); }

  async function createBooking() {
    setBusy(true);
    try {
      const res = await fetch("/api/staff/bookings", {
        method:"POST", headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},
        body:JSON.stringify({ name:form.name, phone:form.phone, email:form.email, dob:form.dob, patientCategory:form.patientCategory, serviceCode:form.serviceCode, date:form.date, time:form.time, comment:form.comment, referralType:"none" }),
      });
      const d = await res.json().catch(()=>({})) as { error?:string; code?:string };
      if (!res.ok) { flash(d.error || "Не вдалося створити"); return; }
      flash(`Заявку створено · ${d.code || ""}`); setCreating(false); setForm(emptyForm); await load();
    } finally { setBusy(false); }
  }

  function startCreate() { if (!guardUnsaved()) return; setCreating(true); setSelectedId(null); setForm({ ...emptyForm, date:todayInKyiv() }); }

  const readOnly = !!data && !["admin","registrar"].includes(data.staff.role);

  const body = forbidden
    ? <section className="accessDenied"><b>Захищений розділ</b><p>Дошка прийому доступна персоналу реєстратури.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fintake">Увійти</a></section>
    : !loaded ? <p className="dashLoading">Завантаження…</p>
    : <div className="intakeBoard">
        <aside className="intakeQueue">
          <div className="intakeQueueTop">
            <div className="intakeSeg">
              <button className={filter==="attention"?"on":""} onClick={()=>setFilter("attention")}>Потребують уваги</button>
              <button className={filter==="all"?"on":""} onClick={()=>setFilter("all")}>Усі</button>
            </div>
            <input type="search" placeholder="Пошук: ім'я, телефон, код" value={query} onChange={e=>setQuery(e.target.value)} />
            {!readOnly && <button className="intakeNew" onClick={startCreate}>＋ Нова заявка</button>}
          </div>
          <ul className="intakeList">
            {list.length === 0 ? <li className="intakeEmpty">Немає заявок за фільтром.</li> : list.map(b => {
              const src = sourceOf.get(b.id);
              return <li key={b.id}>
                <button className={`intakeCard st-${b.status}${b.id===selectedId&&!creating?" active":""}`} onClick={()=>selectBooking(b)}>
                  <span className="intakeCardTop">
                    <b>{b.name || "—"}</b>
                    <span className={`intakeSrc ${src||"site"}`} title={src==="staff"?"Внесено вручну":"Через сайт"}>{src==="staff"?"✍️":"🌐"}</span>
                  </span>
                  <span className="intakeCardSvc">{b.service}</span>
                  <span className="intakeCardMeta">{b.desiredDate} {b.desiredTime} · <i className={`intakeStatus st-${b.status}`}>{STATUS_LABELS[b.status]||b.status}</i></span>
                </button>
              </li>;
            })}
          </ul>
        </aside>

        <section className="intakeDetail">
          {creating ? <>
            <div className="intakeDetailHead"><h2>Нова заявка (вручну)</h2><button className="intakeClose" onClick={()=>setCreating(false)}>✕</button></div>
            <IntakeForm form={form} set={set} times={times} serviceGroups={serviceGroups} />
            <div className="intakeActions">
              <button className="primary" disabled={busy || !form.name || !form.phone || !form.date || !form.time} onClick={()=>void createBooking()}>Створити й підтвердити</button>
              <button onClick={()=>setCreating(false)}>Скасувати</button>
            </div>
          </> : !selected ? <div className="intakePlaceholder"><p>Оберіть заявку ліворуч або створіть нову.</p></div> : <>
            <div className="intakeDetailHead">
              <div>
                <h2>{selected.name || "—"}</h2>
                <small>{selected.code} · <i className={`intakeStatus st-${selected.status}`}>{STATUS_LABELS[selected.status]||selected.status}</i>{ageFrom(selected.dateOfBirth)!==null ? ` · ${ageFrom(selected.dateOfBirth)} р.` : ""}</small>
              </div>
              <div className="intakeHeadActions">
                <a className="intakeCall" href={`tel:${selected.phone}`}>{selected.phone || "—"}</a>
                {digits(selected.phone) && <a className="intakePatientLink" href={`/staff/patients?phone=${digits(selected.phone)}`}>Картка пацієнта →</a>}
                <a className="intakeWa" href={`https://wa.me/${digits(selected.phone)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                {!readOnly && (selected.status==="new"||selected.status==="rescheduled") && <button className="intakeConfirm" disabled={busy} onClick={confirmBooking}>✓ Підтвердити</button>}
              </div>
            </div>

            {/* Notion-стиль: картка «живе» — контекст пацієнта, а не лише форма. */}
            <div className="intakeCtx">
              <div className="intakeChips">
                <span className={`intakeChip route-${selected.patientCategory}`}>{selected.patientCategory==="military"?"Військовий":"Цивільний"}</span>
                {isContrast(selected.service) && <span className="intakeChip contrast">Контраст</span>}
                {selected.patientCategory==="civilian" && <span className={`intakeChip ${selected.paymentStatus==="paid"?"paid":"pay"}`}>{selected.paymentStatus==="paid"?`Оплачено${selected.paymentAmount?` · ${selected.paymentAmount} грн`:""}`:`Перевірити оплату${selected.paymentAmount?` · ${selected.paymentAmount} грн`:""}`}</span>}
                <span className="intakeChip src">{sourceOf.get(selected.id)==="staff"?"✍️ Внесено вручну":"🌐 Через сайт"}</span>
              </div>

              <dl className="intakeFacts">
                <div><dt>Дослідження</dt><dd>{selected.service}{selected.equipmentId?` · ${EQUIP_UK[selected.equipmentId]||selected.equipmentId}`:""}</dd></div>
                <div><dt>Дата й час</dt><dd>{selected.desiredDate} · {selected.desiredTime || "—"}</dd></div>
                <div><dt>Направлення</dt><dd>{REFERRAL_UK[selected.referralType||"none"]||"Без направлення"}{selected.referralNumber?` · № ${selected.referralNumber}`:""}</dd></div>
                <div><dt>Створено</dt><dd>{(selected.createdAt||"").slice(0,10)}{selected.marketingSource?` · ${selected.marketingSource}`:""}</dd></div>
              </dl>

              {isContrast(selected.service) && <p className="intakeNote contrast">Дослідження з контрастуванням — попередьте пацієнта про підготовку (креатинін, алергоанамнез, натще).</p>}

              {selected.comment && <div className="intakeCtxComment"><b>Коментар</b><p>{selected.comment}</p></div>}

              <div className="intakeHistory">
                <div className="intakeHistoryHead"><b>Попередні дослідження</b>{digits(selected.phone) ? <a className="intakeHistoryAll" href={`/staff/patients?phone=${digits(selected.phone)}`}>уся картка →</a> : <span>{history.length}</span>}</div>
                {history.length === 0
                  ? <p className="intakeHistoryEmpty">Перше звернення цього пацієнта (за номером телефону).</p>
                  : <ul>{history.slice(0,8).map(h => <li key={h.id}>
                      <a href={`/staff?open=${h.id}#bookings`}>
                        <span className="ihDate">{h.desiredDate}</span>
                        <span className="ihSvc">{h.service}{h.equipmentId?` · ${EQUIP_UK[h.equipmentId]||h.equipmentId}`:""}</span>
                        <span className={`ihStatus st-${h.status}`}>{STATUS_LABELS[h.status]||h.status}</span>
                      </a></li>)}
                    {history.length>8 && <li className="ihMore">…і ще {history.length-8}</li>}
                  </ul>}
              </div>
            </div>

            {!readOnly && <details className="intakeEdit">
              <summary>Корекція заявки</summary>
              <IntakeForm form={form} set={set} times={times} serviceGroups={serviceGroups} readOnly={readOnly} />
              <div className="intakeActions">
                <button className="primary" disabled={busy} onClick={saveEdits}>Зберегти зміни</button>
                <button disabled={busy || !form.date || !form.time} onClick={reschedule}>Перенести на {form.date} {form.time}</button>
                <button className="danger" disabled={busy} onClick={cancelBooking}>Скасувати заявку</button>
              </div>
            </details>}
          </>}
        </section>
        {toast && <div className="intakeToast" role="status">{toast}</div>}
      </div>;

  return <StaffWorkspaceShell active="intake" title="Дошка прийому" description="Заявки з сайту й ручні — перегляд, корекція та обробка в одному місці." staffName={data?.staff.displayName} staffRole={data?.staff.role}>{body}</StaffWorkspaceShell>;
}

function IntakeForm({ form, set, times, serviceGroups, readOnly=false }:{
  form:Form; set:(k:keyof Form)=>(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>)=>void;
  times:string[]; serviceGroups:Record<string,typeof SERVICES>; readOnly?:boolean;
}) {
  return <div className="intakeForm">
    <label><span>Імʼя пацієнта</span><input value={form.name} readOnly={readOnly} onChange={set("name")} /></label>
    <label><span>Телефон</span><input value={form.phone} readOnly={readOnly} onChange={set("phone")} /></label>
    <label><span>Email</span><input value={form.email} readOnly={readOnly} onChange={set("email")} /></label>
    <label><span>Дата народження</span><input type="date" value={form.dob} readOnly={readOnly} onChange={set("dob")} /></label>
    <label><span>Категорія</span><select value={form.patientCategory} disabled={readOnly} onChange={set("patientCategory")}><option value="civilian">Цивільний</option><option value="military">Військовий</option></select></label>
    <label className="intakeWide"><span>Послуга</span><select value={form.serviceCode} disabled={readOnly} onChange={set("serviceCode")}>
      {Object.entries(serviceGroups).map(([group, items]) => <optgroup key={group} label={group}>
        {items.map(s => <option key={s.code} value={s.code}>{s.code} · {s.title}</option>)}
      </optgroup>)}
    </select></label>
    <label><span>Дата</span><input type="date" value={form.date} readOnly={readOnly} onChange={set("date")} /></label>
    <label><span>Час</span><select value={form.time} disabled={readOnly} onChange={set("time")}>
      <option value="">—</option>
      {(times.includes(form.time) || !form.time ? times : [form.time, ...times]).map(t => <option key={t} value={t}>{t}</option>)}
    </select></label>
    <label className="intakeWide"><span>Коментар</span><textarea rows={2} value={form.comment} readOnly={readOnly} onChange={set("comment")} /></label>
  </div>;
}
