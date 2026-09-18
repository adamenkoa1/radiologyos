"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { EQUIP_KEYS, EQUIP_LABELS, SCHEDULE_DEFAULTS, candidateTimesFor, isEquipmentDayOpen, type ScheduleConfig } from "../../../lib/schedule";
import { SERVICES, addMinutes } from "../../../lib/catalog";
import { configuredService, SERVICE_CONFIG_DEFAULTS, type ServiceConfigRecord } from "../../../lib/service-config";
import { roleLabelUk } from "../../../lib/labels";

type StaffInfo = { email: string; displayName: string; role: string };
type PersonOption = { email: string; displayName: string; role: string; positionTitle?: string; militaryRank?: string };
type EquipBlock = { id: number; equipmentId: string; blockedDate: string; startTime: string; endTime: string; reason: string };
const WEEKDAYS: [number, string][] = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"]];
const CALENDAR_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const EQUIP_ICONS: Record<string, string> = { xray: "XR", fluoro: "FL", ct: "CT" };

function monthKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function monthCells(value: string) {
  const [year, month] = value.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const count = new Date(year, month, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => `${value}-${String(i + 1).padStart(2, "0")}`)];
}

export default function StaffSchedulePage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cfg, setCfg] = useState<ScheduleConfig>(() => JSON.parse(JSON.stringify(SCHEDULE_DEFAULTS)));
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [serviceConfig, setServiceConfig] = useState<ServiceConfigRecord[]>(SERVICE_CONFIG_DEFAULTS.map((row) => ({ ...row })));
  const [activeEquipment, setActiveEquipment] = useState<string>("xray");
  const [calendarMonth, setCalendarMonth] = useState(() => monthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newDay, setNewDay] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [blocks, setBlocks] = useState<EquipBlock[]>([]);
  const [blockForm, setBlockForm] = useState({ startTime: "", endTime: "", reason: "" });
  const [blockBusy, setBlockBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const t = window.setTimeout(async () => {
      try {
        const [res, servicesRes, blocksRes] = await Promise.all([
          fetch("/api/staff/schedule", { cache: "no-store" }),
          fetch("/api/staff/services", { cache: "no-store" }),
          fetch("/api/staff/equipment", { cache: "no-store" }),
        ]);
        if (res.status === 401 || res.status === 403) { if (active) { setForbidden(true); setLoaded(true); } return; }
        const data = await res.json().catch(() => ({})) as { schedule?: ScheduleConfig; staff?: StaffInfo; people?: PersonOption[] };
        const servicesData = await servicesRes.json().catch(() => ({})) as { services?: ServiceConfigRecord[] };
        const blocksData = await blocksRes.json().catch(() => ({})) as { blocks?: EquipBlock[] };
        if (!active) return;
        if (data.schedule) setCfg({ ...JSON.parse(JSON.stringify(SCHEDULE_DEFAULTS)), ...data.schedule });
        if (data.staff) setStaff(data.staff);
        if (Array.isArray(data.people)) setPeople(data.people);
        if (Array.isArray(servicesData.services)) setServiceConfig(servicesData.services);
        if (Array.isArray(blocksData.blocks)) setBlocks(blocksData.blocks);
      } catch {
        if (active) setError("Не вдалося завантажити графік — перевірте зʼєднання");
      } finally {
        if (active) setLoaded(true);
      }
    }, 0);
    return () => { active = false; window.clearTimeout(t); };
  }, []);

  function setHours(key: string, field: "start" | "end" | "slotMinutes" | "breakStart" | "breakEnd" | "radiographerEmail" | "radiologistEmail", value: string) {
    setCfg(prev => ({ ...prev, equipment: { ...prev.equipment, [key]: { ...prev.equipment[key], [field]: field === "slotMinutes" ? Number(value) : value } } }));
  }
  function toggleCalendarDate(date: string) {
    setCfg(prev => {
      const current = isEquipmentDayOpen(date, prev, activeEquipment);
      const equipmentOverrides = { ...(prev.dateOverrides?.[activeEquipment] || {}), [date]: !current };
      return { ...prev, dateOverrides: { ...(prev.dateOverrides || {}), [activeEquipment]: equipmentOverrides } };
    });
  }
  function resetMonthOverrides() {
    setCfg(prev => {
      const current = { ...(prev.dateOverrides?.[activeEquipment] || {}) };
      Object.keys(current).filter(date => date.startsWith(calendarMonth)).forEach(date => delete current[date]);
      return { ...prev, dateOverrides: { ...(prev.dateOverrides || {}), [activeEquipment]: current } };
    });
  }
  function clearBreak(key: string) {
    setCfg(prev => {
      const rest = { ...prev.equipment[key] };
      delete rest.breakStart; delete rest.breakEnd;
      return { ...prev, equipment: { ...prev.equipment, [key]: rest } };
    });
  }
  function toggleWeekday(d: number) {
    setCfg(prev => {
      const room = prev.equipment[activeEquipment];
      const current = room.weekdays ?? prev.weekdays;
      const weekdays = current.includes(d) ? current.filter(x => x !== d) : [...current, d].sort((a, b) => a - b);
      return { ...prev, equipment: { ...prev.equipment, [activeEquipment]: { ...room, weekdays } } };
    });
  }
  function toggleTeamMember(email: string) {
    setCfg(prev => {
      const room = prev.equipment[activeEquipment];
      const current = room.teamEmails || [];
      const teamEmails = current.includes(email) ? current.filter(value => value !== email) : [...current, email];
      return { ...prev, equipment: { ...prev.equipment, [activeEquipment]: { ...room, teamEmails } } };
    });
  }
  function addDayOff() {
    const current = cfg.equipment[activeEquipment].daysOff ?? cfg.daysOff;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDay)) { setError("Вкажіть дату, щоб закрити її для кабінету."); return; }
    if (current.includes(newDay)) { setError("Цю дату вже закрито для цього кабінету."); return; }
    setError("");
    setCfg(prev => {
      const room = prev.equipment[activeEquipment];
      const daysOff = [...(room.daysOff ?? prev.daysOff), newDay].sort();
      return { ...prev, equipment: { ...prev.equipment, [activeEquipment]: { ...room, daysOff } } };
    });
    setNewDay("");
  }

  async function reloadBlocks() {
    try {
      const r = await fetch("/api/staff/equipment", { cache: "no-store" });
      const d = await r.json().catch(() => ({})) as { blocks?: EquipBlock[] };
      if (Array.isArray(d.blocks)) setBlocks(d.blocks);
    } catch { /* ignore */ }
  }
  async function addBlock() {
    if (blockBusy || !blockForm.startTime || !blockForm.endTime) return;
    setBlockBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/staff/equipment", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ equipmentId: activeEquipment, blockedDate: selectedDate, startTime: blockForm.startTime, endTime: blockForm.endTime, reason: blockForm.reason }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || "Не вдалося заблокувати час");
      setBlockForm({ startTime: "", endTime: "", reason: "" });
      await reloadBlocks();
      setNotice("Час заблоковано");
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося заблокувати час"); }
    finally { setBlockBusy(false); }
  }
  async function removeBlock(id: number) {
    setBlockBusy(true); setError("");
    try {
      const res = await fetch(`/api/staff/equipment?id=${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || "Не вдалося зняти блок");
      await reloadBlocks();
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зняти блок"); }
    finally { setBlockBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving"); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/schedule", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ schedule: cfg }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; schedule?: ScheduleConfig; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      if (data.schedule) setCfg({ ...JSON.parse(JSON.stringify(SCHEDULE_DEFAULTS)), ...data.schedule });
      setNotice("Графік збережено. Слоти на записі оновляться відповідно.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти"); }
    finally { setStatus("idle"); }
  }

  const canEdit = staff?.role === "admin";
  const body = forbidden
    ? <p className="notice error" role="alert">Графік доступний лише персоналу відділення. Увійдіть під робочим обліковим записом.</p>
    : !loaded
      ? <p className="notice">Завантаження…</p>
      : <form className="settingsCard" onSubmit={save}>
          <section className="settingsBlock scheduleIntro">
            <h3>Графік роботи кабінетів</h3>
            <p className="settingsHint">Оберіть кабінет, задайте години, крок запису, обід і відповідальних працівників. Зміни одразу впливають на доступні слоти після збереження.</p>
            <div className="scheduleRoomTabs" role="tablist" aria-label="Кабінети">
              {EQUIP_KEYS.map(key => <button type="button" role="tab" aria-selected={activeEquipment === key} className={activeEquipment === key ? "active" : ""} key={key} onClick={() => setActiveEquipment(key)}>
                <span>{EQUIP_ICONS[key]}</span>{EQUIP_LABELS[key]}
              </button>)}
            </div>
          </section>

          <section className="settingsBlock roomScheduleCard">
            <div className="roomScheduleHead">
              <div><span className="roomCode">{EQUIP_ICONS[activeEquipment]}</span><div><h3>{EQUIP_LABELS[activeEquipment]}</h3><p>Робочий діапазон і команда кабінету</p></div></div>
            </div>
            <div className="roomFields">
              <label><span>Початок роботи</span><input type="time" value={cfg.equipment[activeEquipment].start} onChange={e => setHours(activeEquipment, "start", e.target.value)} /></label>
              <label><span>Завершення</span><input type="time" value={cfg.equipment[activeEquipment].end} onChange={e => setHours(activeEquipment, "end", e.target.value)} /></label>
              <label><span>Крок запису, хв</span><input type="number" min={5} max={240} step={5} value={cfg.equipment[activeEquipment].slotMinutes} onChange={e => setHours(activeEquipment, "slotMinutes", e.target.value)} /></label>
              <label><span>Обід з</span><input type="time" value={cfg.equipment[activeEquipment].breakStart ?? ""} onChange={e => setHours(activeEquipment, "breakStart", e.target.value)} /></label>
              <label><span>Обід до</span><input type="time" value={cfg.equipment[activeEquipment].breakEnd ?? ""} onChange={e => setHours(activeEquipment, "breakEnd", e.target.value)} /></label>
            </div>
            {(cfg.equipment[activeEquipment].breakStart || cfg.equipment[activeEquipment].breakEnd) && <button type="button" className="breakClear" onClick={() => clearBreak(activeEquipment)}>Прибрати обідню перерву</button>}
            <div className="roomTeamTitle"><b>Відповідальні працівники</b><a href="/staff#staff-admin">Редагувати персонал →</a></div>
            <div className="roomTeamFields">
              <label><span>Рентгенолаборант у кабінеті</span><select value={cfg.equipment[activeEquipment].radiographerEmail ?? ""} onChange={e => setHours(activeEquipment, "radiographerEmail", e.target.value)}><option value="">Не призначено</option>{people.filter(p => p.role === "radiographer").map(p => <option key={p.email} value={p.email}>{p.displayName || p.email}</option>)}</select></label>
              <label><span>Лікар-рентгенолог, який описує</span><select value={cfg.equipment[activeEquipment].radiologistEmail ?? ""} onChange={e => setHours(activeEquipment, "radiologistEmail", e.target.value)}><option value="">Не призначено</option>{people.filter(p => p.role === "radiologist").map(p => <option key={p.email} value={p.email}>{p.displayName || p.email}</option>)}</select></label>
            </div>
            <div className="roomRoster">
              <div><b>Команда кабінету — додатковий персонал</b><span>Чергові, санітарки та інші працівники без повторення відповідальних</span></div>
              <div className="roomRosterGrid">{people.filter(person => person.email !== cfg.equipment[activeEquipment].radiographerEmail && person.email !== cfg.equipment[activeEquipment].radiologistEmail).map(person => {
                const selected = (cfg.equipment[activeEquipment].teamEmails || []).includes(person.email);
                return <button type="button" key={person.email} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => toggleTeamMember(person.email)}>
                  <i aria-hidden="true">{selected ? "✓" : "+"}</i><span><b>{person.displayName || person.email}</b><small>{[person.militaryRank, person.positionTitle].filter(Boolean).join(" · ") || person.role}</small></span>
                </button>;
              })}</div>
              {people.length === 0 && <p className="settingsHint">Спочатку додайте працівників у розділі «Персонал».</p>}
            </div>
            <div className="roomServices">
              <div className="roomServicesHead">
                <div><b>Послуги цього кабінету</b><span>Під час запису пацієнта показуються послуги, прив’язані саме до цього обладнання.</span></div>
                <a href="/staff/tariffs">Редагувати тарифи →</a>
              </div>
              <div className="roomServiceGroups">
                {Object.entries(SERVICES.map(service => configuredService(service, serviceConfig)).filter(service => service.active && service.equipmentId === activeEquipment).reduce<Record<string, typeof SERVICES>>((groups, service) => {
                  (groups[service.group] ||= []).push(service);
                  return groups;
                }, {})).map(([group, services]) => <details key={group} open>
                  <summary><span>{group}</span><i>{services.length}</i></summary>
                  <ul>{services.map(service => <li key={service.code}>
                    <span className="roomServiceCode">{service.code}</span>
                    <span><b>{service.title}</b><small>{service.durationMinutes} хв · {service.price.toLocaleString("uk-UA")} грн для цивільних</small></span>
                  </li>)}</ul>
                </details>)}
              </div>
            </div>
          </section>

          <section className="settingsBlock monthScheduleCard">
            <div className="monthScheduleHead"><div><h3>Календар роботи кабінету</h3><p>Оберіть дату — нижче побачите весь робочий день, поділений на реальні слоти.</p></div><input aria-label="Місяць календаря" type="month" value={calendarMonth} onChange={e => { setCalendarMonth(e.target.value); setSelectedDate(`${e.target.value}-01`); }} /></div>
            <div className="calendarLegend"><span><i className="working" />Робочий день</span><span><i className="closed" />Неробочий день</span><span><i className="changed" />Змінено вручну</span></div>
            <div className="roomMonthCalendar">
              {CALENDAR_DAYS.map(day => <b key={day}>{day}</b>)}
              {monthCells(calendarMonth).map((date, index) => date ? <button type="button" key={date} onClick={() => setSelectedDate(date)} className={`${isEquipmentDayOpen(date, cfg, activeEquipment) ? "working" : "closed"}${typeof cfg.dateOverrides?.[activeEquipment]?.[date] === "boolean" ? " changed" : ""}${selectedDate === date ? " selected" : ""}`} aria-label={`${date}: ${isEquipmentDayOpen(date, cfg, activeEquipment) ? "робочий" : "неробочий"} день`}><span>{Number(date.slice(-2))}</span><small>{isEquipmentDayOpen(date, cfg, activeEquipment) ? `${candidateTimesFor(cfg.equipment[activeEquipment], cfg.equipment[activeEquipment].slotMinutes).length} слотів` : "Вихідний"}</small>{isEquipmentDayOpen(date, cfg, activeEquipment) && <i className="slotBars" aria-hidden="true">{candidateTimesFor(cfg.equipment[activeEquipment], cfg.equipment[activeEquipment].slotMinutes).slice(0, 12).map(time => <em key={time} />)}</i>}</button> : <span className="calendarEmpty" key={`empty-${index}`} />)}
            </div>
            <div className="selectedDaySchedule">
              <div className="selectedDayHead"><div><b>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })}</b><span>{EQUIP_LABELS[activeEquipment]} · крок {cfg.equipment[activeEquipment].slotMinutes} хв</span></div><button type="button" className={isEquipmentDayOpen(selectedDate, cfg, activeEquipment) ? "dayOpen" : "dayClosed"} onClick={() => toggleCalendarDate(selectedDate)}><i />{isEquipmentDayOpen(selectedDate, cfg, activeEquipment) ? "Робочий день" : "Неробочий день"}</button></div>
              {isEquipmentDayOpen(selectedDate, cfg, activeEquipment) ? <div className="daySlotTimeline">{candidateTimesFor(cfg.equipment[activeEquipment], cfg.equipment[activeEquipment].slotMinutes).map(time => {
                const slotEnd = addMinutes(time, cfg.equipment[activeEquipment].slotMinutes);
                const isBlocked = blocks.some(b => b.equipmentId === activeEquipment && b.blockedDate === selectedDate && time < b.endTime && slotEnd > b.startTime);
                return <span key={time} className="daySlot" title={isBlocked ? "Заблоковано" : undefined} style={isBlocked ? { opacity: 0.4, textDecoration: "line-through" } : undefined}>{time}</span>;
              })}</div> : <p className="closedDayMessage">Запис на цю дату закритий. Увімкніть робочий день перемикачем вище.</p>}
              {isEquipmentDayOpen(selectedDate, cfg, activeEquipment) && cfg.equipment[activeEquipment].breakStart && cfg.equipment[activeEquipment].breakEnd && <p className="lunchNote">Обідня перерва: <b>{cfg.equipment[activeEquipment].breakStart}–{cfg.equipment[activeEquipment].breakEnd}</b> — слоти в цей час не створюються.</p>}
              {staff?.role === "admin" && isEquipmentDayOpen(selectedDate, cfg, activeEquipment) && (() => {
                const dayBlocks = blocks.filter(b => b.equipmentId === activeEquipment && b.blockedDate === selectedDate);
                return <div className="slotBlockPanel" style={{ marginTop: 12, borderTop: "1px solid #e2eae8", paddingTop: 12 }}>
                  <b style={{ fontSize: 14 }}>Заблокувати окремий час</b>
                  <p className="settingsHint" style={{ margin: "4px 0 8px" }}>Напр. планове ТО апарата — ці слоти зникнуть з онлайн-запису, не закриваючи весь день.</p>
                  {dayBlocks.length > 0 && <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px" }}>{dayBlocks.map(b =>
                    <li key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                      <b>{b.startTime}–{b.endTime}</b>{b.reason ? <span style={{ color: "#677873" }}>{b.reason}</span> : null}
                      <button type="button" disabled={blockBusy} onClick={() => removeBlock(b.id)} style={{ marginLeft: "auto" }}>Зняти</button>
                    </li>)}</ul>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
                    <label style={{ display: "grid", gap: 3 }}><span>З</span><input type="time" value={blockForm.startTime} onChange={e => setBlockForm(f => ({ ...f, startTime: e.target.value }))} /></label>
                    <label style={{ display: "grid", gap: 3 }}><span>До</span><input type="time" value={blockForm.endTime} onChange={e => setBlockForm(f => ({ ...f, endTime: e.target.value }))} /></label>
                    <label style={{ display: "grid", gap: 3, flex: 1, minWidth: 160 }}><span>Причина (необов’язково)</span><input type="text" maxLength={240} placeholder="напр. ТО апарата" value={blockForm.reason} onChange={e => setBlockForm(f => ({ ...f, reason: e.target.value }))} /></label>
                    <button type="button" className="button" disabled={blockBusy || !blockForm.startTime || !blockForm.endTime} onClick={addBlock}>Заблокувати час</button>
                  </div>
                </div>;
              })()}
            </div>
            <button type="button" className="monthReset" onClick={resetMonthOverrides}>Скинути ручні зміни цього місяця</button>
          </section>

          <section className="settingsBlock compactWeekdays">
            <h3>Робочі дні — {EQUIP_LABELS[activeEquipment]}</h3>
            <p className="settingsHint">Власний шаблон цього кабінету. Окрему дату можна змінити у календарі вище.</p>
            <div className="weekdaySwitches">{WEEKDAYS.map(([d, label]) => <button type="button" key={d} aria-pressed={(cfg.equipment[activeEquipment].weekdays ?? cfg.weekdays).includes(d)} className={(cfg.equipment[activeEquipment].weekdays ?? cfg.weekdays).includes(d) ? "on" : ""} onClick={() => toggleWeekday(d)}><span>{label}</span><i aria-hidden="true" /></button>)}<button type="button" disabled className="sunday"><span>Нд</span><i aria-hidden="true" /></button></div>
            <div className="dayOffAdd"><input type="date" value={newDay} onChange={e => setNewDay(e.target.value)} /><button type="button" className="button secondary" onClick={addDayOff}>Закрити дату для цього кабінету</button></div>
            {(cfg.equipment[activeEquipment].daysOff ?? cfg.daysOff).length > 0 && <ul className="dayOffList">{(cfg.equipment[activeEquipment].daysOff ?? cfg.daysOff).map(d => <li key={d}>{d}<button type="button" onClick={() => setCfg(prev => {
              const room = prev.equipment[activeEquipment];
              return { ...prev, equipment: { ...prev.equipment, [activeEquipment]: { ...room, daysOff: (room.daysOff ?? prev.daysOff).filter(x => x !== d) } } };
            })}>×</button></li>)}</ul>}
          </section>

          {notice && <p className="notice success" role="status">{notice}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
          <div className="settingsActions">
            {canEdit
              ? <button type="submit" disabled={status === "saving"}>{status === "saving" ? "Зберігаємо…" : "Зберегти графік"}</button>
              : <p className="settingsHint">Графік редагує адміністратор. Ви можете переглядати години, слоти й відповідальних.</p>}
            <a className="textLink" href="/staff/appointments">До календаря</a>
          </div>
        </form>;

  return (
    <StaffWorkspaceShell active="schedule" title="Графік роботи кабінетів" description="Режим роботи, слоти, календар і відповідальний персонал для кожного кабінету." staffName={staff?.displayName} staffRole={roleLabelUk(staff?.role)}>
      {body}
    </StaffWorkspaceShell>
  );
}
