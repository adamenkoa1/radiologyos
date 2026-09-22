"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import NameSuggestInput from "../NameSuggestInput";
import { todayInKyiv } from "../../../lib/booking-rules";

type StaffInfo = { email: string; displayName: string; role: string };
type StaffOption = { email: string; displayName: string; role: string };
type EffectiveService = {
  code: string;
  title: string;
  group: string;
  equipmentId: string;
  durationMinutes: number;
  price: number;
  active: boolean;
  military: boolean;
  civilian: boolean;
};

const money = new Intl.NumberFormat("uk-UA");
const REFERRALS: [string, string][] = [
  ["none", "Немає направлення"],
  ["military_referral", "Направлення військової частини/закладу"],
  ["eh_referral", "Електронне направлення"],
  ["paper_referral", "Паперове направлення"],
  ["other", "Інше"],
];

export default function StaffBookPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [options, setOptions] = useState<StaffOption[]>([]);
  const [services, setServices] = useState<EffectiveService[]>([]);
  const [serviceCode, setServiceCode] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [requestedTime, setRequestedTime] = useState("");
  const [times, setTimes] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [patientId, setPatientId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [category, setCategory] = useState("civilian");
  const [patientFlags, setPatientFlags] = useState<{ contrastAlert: boolean; doNotContact: boolean } | null>(null);
  const [nearest, setNearest] = useState("");

  const availableServices = useMemo(
    () => services.filter((service) => service.active && (category === "military" ? service.military : service.civilian)),
    [services, category],
  );
  const serviceGroups = useMemo(() => {
    const groups: Record<string, EffectiveService[]> = {};
    for (const service of availableServices) {
      (groups[service.group] ||= []).push(service);
    }
    return groups;
  }, [availableServices]);
  const radiologists = useMemo(() => options.filter(o => o.role === "radiologist"), [options]);
  const radiographers = useMemo(() => options.filter(o => o.role === "radiographer"), [options]);

  useEffect(() => {
    let active = true;
    const t = window.setTimeout(async () => {
      const [bookingRes, serviceRes] = await Promise.all([
        fetch("/api/staff/bookings", { cache: "no-store" }),
        fetch("/api/staff/services", { cache: "no-store" }),
      ]);
      if (bookingRes.status === 403 || serviceRes.status === 403) {
        if (active) setForbidden(true);
        return;
      }
      const bookingData = await bookingRes.json().catch(() => ({})) as { staffOptions?: StaffOption[]; staff?: StaffInfo };
      const serviceData = await serviceRes.json().catch(() => ({})) as { effectiveServices?: EffectiveService[]; staff?: StaffInfo };
      if (!active) return;
      setOptions(bookingData.staffOptions || []);
      setServices(Array.isArray(serviceData.effectiveServices) ? serviceData.effectiveServices : []);
      if (bookingData.staff) setStaff(bookingData.staff);
      else if (serviceData.staff) setStaff(serviceData.staff);
    }, 0);
    return () => { active = false; window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedDate = params.get("date") || "";
      const requestedSlot = params.get("time") || "";
      const equipment = params.get("equipment") || "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setDate(requestedDate);
      if (/^\d{2}:\d{2}$/.test(requestedSlot)) setRequestedTime(requestedSlot);
      const firstService = Object.values(serviceGroups).flat().find(service => service.equipmentId === equipment);
      if (firstService) setServiceCode(firstService.code);
      const pPatientId = (params.get("patientId") || "").trim().toLowerCase();
      if (/^[0-9a-f]{32}$/.test(pPatientId)) setPatientId(pPatientId);
      const pName = params.get("name"); if (pName) setName(pName.slice(0, 120));
      const pPhone = params.get("phone"); if (pPhone) setPhone(pPhone.slice(0, 20));
      const pDob = params.get("dob"); if (pDob && /^\d{4}-\d{2}-\d{2}$/.test(pDob)) setDob(pDob);
      const pCat = params.get("category"); if (pCat === "military" || pCat === "civilian") setCategory(pCat);
    }, 0);
    return () => window.clearTimeout(t);
  }, [serviceGroups]);

  // Прапорці CRM-картки (реакція на контраст / «не турбувати») — щоб реєстратор
  // бачив застереження, записуючи на КТ з контрастуванням.
  useEffect(() => {
    let active = true;
    const t = window.setTimeout(() => {
      if (!/^[0-9a-f]{32}$/.test(patientId)) { setPatientFlags(null); return; }
      fetch(`/api/staff/patients?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then((card: { profile?: { contrastAlert?: number; doNotContact?: number } } | null) => {
          if (active && card) setPatientFlags({ contrastAlert: !!card.profile?.contrastAlert, doNotContact: !!card.profile?.doNotContact });
        })
        .catch(() => { if (active) setPatientFlags(null); });
    }, 0);
    return () => { active = false; window.clearTimeout(t); };
  }, [patientId]);

  // Якщо на обрану дату вільного часу немає — знайти найближчу вільну дату
  // (сканує до 14 днів наперед), щоб реєстратор не клацав дати наосліп.
  useEffect(() => {
    let active = true;
    const t = window.setTimeout(() => {
      setNearest("");
      if (!date || !serviceCode || slotsLoading || times.length > 0) return;
      (async () => {
        const start = new Date(`${date}T00:00:00`);
        for (let i = 1; i <= 14 && active; i++) {
          const probe = new Date(start); probe.setDate(probe.getDate() + i);
          const iso = probe.toISOString().slice(0, 10);
          try {
            const r = await fetch(`/api/availability?date=${iso}&serviceCode=${encodeURIComponent(serviceCode)}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({})) as { times?: string[] };
            if (active && (j.times || []).length) { setNearest(iso); break; }
          } catch { /* ігноруємо збій окремої дати */ }
        }
      })();
    }, 0);
    return () => { active = false; window.clearTimeout(t); };
  }, [date, serviceCode, slotsLoading, times.length]);

  useEffect(() => {
    let active = true;
    const t = window.setTimeout(() => {
      if (!date || !serviceCode) { setTimes([]); setSlotsLoading(false); return; }
      setSlotsLoading(true); setTime("");
      fetch(`/api/availability?date=${encodeURIComponent(date)}&serviceCode=${encodeURIComponent(serviceCode)}`, { cache: "no-store" })
        .then(r => r.json()).then((d: { times?: string[] }) => { if (active) { const available=d.times || []; setTimes(available); if (requestedTime && available.includes(requestedTime)) setTime(requestedTime); } })
        .catch(() => { if (active) setTimes([]); })
        .finally(() => { if (active) setSlotsLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(t); };
  }, [date, serviceCode, requestedTime]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving"); setError(""); setCode("");
    const data = new FormData(event.currentTarget);
    const res = await fetch(patientId ? "/api/staff/bookings/exact" : "/api/staff/bookings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(patientId ? { patientId } : {}),
        name: String(data.get("name") || ""),
        phone: String(data.get("phone") || ""),
        dob: String(data.get("dob") || ""),
        patientCategory: String(data.get("patientCategory") || "civilian"),
        serviceCode, date, time,
        referralType: String(data.get("referralType") || "none"),
        clinicalIndication: String(data.get("clinicalIndication") || ""),
        comment: String(data.get("comment") || ""),
        assignedRadiologistEmail: String(data.get("radiologist") || ""),
        assignedRadiographerEmail: String(data.get("radiographer") || ""),
      }),
    });
    const result = await res.json().catch(() => ({})) as { ok?: boolean; code?: string; error?: string };
    setStatus("idle");
    if (!res.ok || !result.ok) { setError(result.error || "Не вдалося створити запис"); return; }
    setCode(result.code || "");
    (event.target as HTMLFormElement).reset();
    setServiceCode(""); setDate(""); setTime(""); setRequestedTime(""); setTimes([]);
    setPatientId(""); setName(""); setPhone(""); setDob(""); setCategory("civilian");
  }

  const selectedService = availableServices.find((service) => service.code === serviceCode);
  const price = selectedService?.price;
  const isContrastService = /контраст|ангіограф/i.test(selectedService?.group || "");
  const noSlots = Boolean(date && serviceCode && !slotsLoading && times.length === 0);

  const body = forbidden
    ? <p className="notice error" role="alert">Створювати записи може реєстратор або адміністратор.</p>
    : <form className="settingsCard" onSubmit={submit}>
        {code && <p className="notice success" role="status">Пацієнта записано, час підтверджено. <a className="textLink" href="/staff/appointments">Переглянути в календарі →</a></p>}
        <p className="settingsHint">Ця форма призначена для запису від імені пацієнта, який звернувся телефоном або не може самостійно скористатися сайтом.</p>
        {patientId && <p className="settingsHint">Запис буде додано до вибраної CRM-картки пацієнта.</p>}
        {isContrastService && patientFlags?.contrastAlert && <p className="notice error" role="alert">⚠ У картці пацієнта є позначка про реакцію на контрастну речовину. Контрастне дослідження узгодьте з лікарем.</p>}
        {patientFlags?.doNotContact && <p className="notice" role="status">ℹ Пацієнт має позначку «Не турбувати».</p>}
        <section className="settingsBlock">
          <h3>Дані пацієнта</h3>
          <label className="settingsField"><span>Прізвище, імʼя та по батькові *</span><NameSuggestInput name="name" required maxLength={120} placeholder="Іваненко Іван Іванович" value={name} onChange={setName} /></label>
          <label className="settingsField"><span>Телефон *</span><input name="phone" required inputMode="tel" placeholder="+380 97 000 00 00" value={phone} onChange={e=>setPhone(e.target.value)} /></label>
          <label className="settingsField"><span>Дата народження</span><input name="dob" type="date" max="2100-12-31" min="1920-01-01" value={dob} onChange={e=>setDob(e.target.value)} /></label>
          <label className="settingsField"><span>Категорія</span>
            <select name="patientCategory" value={category} onChange={e=>{ setCategory(e.target.value); setServiceCode(""); setTime(""); setTimes([]); }}>
              <option value="civilian">Цивільний пацієнт</option>
              <option value="military">Військовослужбовець</option>
            </select>
          </label>
        </section>

        <section className="settingsBlock">
          <h3>Послуга й час</h3>
          <label className="settingsField"><span>Послуга *</span>
            <select value={serviceCode} onChange={e => setServiceCode(e.target.value)} required>
              <option value="" disabled>Оберіть послугу</option>
              {Object.entries(serviceGroups).map(([group, items]) => (
                <optgroup label={group} key={group}>
                  {items.map(s => <option value={s.code} key={s.code}>{s.code} · {s.title} · {money.format(s.price)} грн</option>)}
                </optgroup>
              ))}
            </select>
            {price !== undefined && <small className="settingsHint">Орієнтовна вартість: {money.format(price)} грн</small>}
          </label>
          <label className="settingsField"><span>Дата *</span><input type="date" required min={todayInKyiv()} value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="settingsField"><span>Час *</span>
            <select value={time} onChange={e => setTime(e.target.value)} required disabled={!date || !serviceCode || slotsLoading}>
              <option value="" disabled>{!serviceCode ? "Спершу оберіть послугу" : !date ? "Оберіть дату" : slotsLoading ? "Перевіряємо…" : times.length ? "Оберіть час" : "Вільного часу немає"}</option>
              {times.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          {noSlots && nearest && <p className="settingsHint">Найближча вільна дата: <button type="button" className="textLink" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setDate(nearest)}>{nearest.split("-").reverse().join(".")} — обрати</button></p>}
          {noSlots && !nearest && <p className="settingsHint">На найближчі 2 тижні вільного часу не знайдено — оберіть іншу дату або зателефонуйте пацієнту пізніше.</p>}
        </section>

        <section className="settingsBlock">
          <h3>Призначення та деталі</h3>
          <label className="settingsField"><span>Лікар-рентгенолог</span>
            <select name="radiologist" defaultValue="">
              <option value="">— Не призначено</option>
              {radiologists.map(o => <option value={o.email} key={o.email}>{o.displayName || o.email}</option>)}
            </select>
          </label>
          <label className="settingsField"><span>Лаборант</span>
            <select name="radiographer" defaultValue="">
              <option value="">— Не призначено</option>
              {radiographers.map(o => <option value={o.email} key={o.email}>{o.displayName || o.email}</option>)}
            </select>
          </label>
          <label className="settingsField"><span>Тип направлення</span>
            <select name="referralType" defaultValue="none">
              {REFERRALS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}
            </select>
          </label>
          <label className="settingsField"><span>Клінічні показання / діагноз направлення</span><input name="clinicalIndication" maxLength={400} placeholder="Напр.: підозра на ТЕЛА; контроль після пневмонії" /></label>
          <label className="settingsField"><span>Причина звернення / коментар</span><textarea name="comment" rows={3} maxLength={700} placeholder="Скарги, важливі деталі" /></label>
        </section>

        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="settingsActions">
          <button type="submit" disabled={status === "saving"}>{status === "saving" ? "Створюємо…" : "Створити запис"}</button>
          <a className="textLink" href="/staff/appointments">До календаря</a>
        </div>
      </form>;

  return (
    <StaffWorkspaceShell active="appointments" title="Записати пацієнта" description="Оформлення запису працівником від імені пацієнта." staffName={staff?.displayName} staffRole={staff?.role}>
      {body}
    </StaffWorkspaceShell>
  );
}
