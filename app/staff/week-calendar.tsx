"use client";

// Спільний тижневий календар записів. Використовується і на окремій сторінці
// «Календар записів», і в пульті відділення (об'єднаний перегляд). Компонент
// презентаційний: дані (bookings, staffOptions) приходять пропсами, а стан
// вигляду/дати/фільтра — локальний.

import { useMemo, useState } from "react";
import { stateLabel } from "../../lib/study-state";

export type CalBooking = {
  id: number; code: string; name: string; phone: string; service: string;
  equipmentId: string; durationMinutes: number; desiredDate: string; desiredTime: string;
  status: string; patientCategory?: string; paymentStatus?: string; paymentAmount?: number; paidAmount?: number;
  assignedRadiologistEmail?: string; assignedRadiographerEmail?: string;
};
export type CalStaffOption = { email: string; displayName: string; role: string };
export type CalView = "list" | "day" | "week";

const GROUPS: Record<string, string[]> = {
  planned: ["new", "requested", "needs_verification", "scheduled", "rescheduled"],
  confirmed: ["confirmed"],
  arrived: ["arrived"],
  inroom: ["queued", "in_progress"],
  done: ["performed", "images_ready", "reporting", "protocol_ready", "issued", "completed"],
  cancelled: ["cancelled", "no_show"],
};
const TABS: { key: string; label: string }[] = [
  { key: "all", label: "Усі" },
  { key: "planned", label: "Заплановані" },
  { key: "confirmed", label: "Підтверджені" },
  { key: "arrived", label: "Прибув" },
  { key: "inroom", label: "У кабінеті" },
  { key: "done", label: "Завершено" },
  { key: "cancelled", label: "Скасовані" },
];
function groupOf(status: string): string {
  for (const [group, list] of Object.entries(GROUPS)) if (list.includes(status)) return group;
  return "planned";
}
const EQUIP: Record<string, string> = { ct: "КТ", xray: "Рентген", fluoro: "Флюорограф" };
const WEEKDAY = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const DAY_START = 8, DAY_END = 19, HOUR_PX = 76;

function todayKyiv(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fmtDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + delta); return fmtDate(d);
}
function weekDates(dateStr: string): string[] {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); // → понеділок
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setUTCDate(d.getUTCDate() + i); return fmtDate(x); });
}

export default function WeekCalendar({
  bookings, options = [], initialView = "week", initialDate,
}: {
  bookings: CalBooking[];
  options?: CalStaffOption[];
  initialView?: CalView;
  initialDate?: string;
}) {
  const [date, setDate] = useState(initialDate || todayKyiv());
  const [view, setView] = useState<CalView>(initialView);
  const [tab, setTab] = useState("all");
  const [category, setCategory] = useState("all");
  const [payment, setPayment] = useState("all");
  const [search, setSearch] = useState("");

  const nameByEmail = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of options) map[o.email] = o.displayName || o.email;
    return map;
  }, [options]);

  const q = search.trim().toLowerCase();
  const matchesExtra = (b: CalBooking) =>
    (category === "all" || b.patientCategory === category)
    && (payment === "all" || (payment === "paid" ? b.paymentStatus === "paid" : b.patientCategory === "civilian" && b.paymentStatus !== "paid"));

  const dayItems = useMemo(() => bookings
    .filter(b => b.desiredDate === date && matchesExtra(b) && ((tab === "all" || GROUPS[tab]?.includes(b.status)) && (!q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q))))
    .sort((a, b) => (a.desiredTime || "").localeCompare(b.desiredTime || "")),
  [bookings, date, tab, category, payment, q]);

  const week = useMemo(() => weekDates(date), [date]);
  const weekItems = useMemo(() => bookings.filter(b => week.includes(b.desiredDate) && matchesExtra(b)
    && ((tab === "all" || GROUPS[tab]?.includes(b.status)) && (!q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q)))),
  [bookings, week, tab, category, payment, q]);

  const counts = useMemo(() => {
    const scope = view === "week" ? bookings.filter(b => week.includes(b.desiredDate)) : bookings.filter(b => b.desiredDate === date);
    const out: Record<string, number> = { all: scope.length };
    for (const t of TABS) if (t.key !== "all") out[t.key] = scope.filter(b => GROUPS[t.key].includes(b.status)).length;
    return out;
  }, [bookings, date, week, view]);

  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  const doctorOf = (b: CalBooking) => nameByEmail[b.assignedRadiologistEmail || ""] || nameByEmail[b.assignedRadiographerEmail || ""] || "";

  function eventBlock(b: CalBooking, compact: boolean) {
    const mins = minutesOf(b.desiredTime);
    if (mins === null) return null;
    const top = Math.max(0, ((mins - DAY_START * 60) / 60) * HOUR_PX);
    const height = Math.max(compact ? 20 : 24, ((b.durationMinutes || 30) / 60) * HOUR_PX - 3);
    return (
      <a href={`/staff?open=${b.id}#bookings`} className={`apptEvent grp-${groupOf(b.status)} route-${b.patientCategory || "unknown"} ${b.paymentStatus==="paid"?"paid":"unpaid"}`} key={b.id} style={{ top, height }} title={`${b.desiredTime} · ${b.name} · ${b.service}`}>
        <b>{b.desiredTime} {b.name || "Без імені"}</b>
        {!compact && <span>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doctorOf(b) ? ` · ${doctorOf(b)}` : ""}</span>}
        {compact && <span>{EQUIP[b.equipmentId] || b.service}</span>}
        <em>{b.patientCategory==="military"?"Військовий":b.paymentStatus==="paid"?"Оплачено":"Цивільний · перевірити оплату"}</em>
      </a>
    );
  }

  const rangeLabel = view === "week"
    ? `${week[0].slice(8)}–${week[6].slice(8)}.${week[0].slice(5, 7)}`
    : date;

  return (
    <div className="apptCal">
      <div className="apptCalBar">
        <div className="apptNav">
          <button type="button" onClick={() => setDate(addDays(date, view === "week" ? -7 : -1))} aria-label="Назад">‹</button>
          <button type="button" className="apptToday" onClick={() => setDate(todayKyiv())}>Сьогодні</button>
          <button type="button" onClick={() => setDate(addDays(date, view === "week" ? 7 : 1))} aria-label="Вперед">›</button>
          <span className="apptRange">{rangeLabel}</span>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <select aria-label="Категорія пацієнта" value={category} onChange={e=>setCategory(e.target.value)}>
          <option value="all">Усі пацієнти</option><option value="military">Військові</option><option value="civilian">Цивільні</option>
        </select>
        <select aria-label="Оплата" value={payment} onChange={e=>setPayment(e.target.value)}>
          <option value="all">Будь-яка оплата</option><option value="pending">Перевірити оплату</option><option value="paid">Оплату перевірено</option>
        </select>
        <input type="search" placeholder="Пошук за пацієнтом…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="apptViewToggle">
          <button type="button" className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Тиждень</button>
          <button type="button" className={view === "day" ? "active" : ""} onClick={() => setView("day")}>День</button>
          <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Список</button>
        </div>
        <a className="apptNewBtn" href="/staff/book">+ Записати пацієнта</a>
      </div>
      <div className="apptStatusRow">
        {TABS.map(t => (
          <button type="button" key={t.key} className={`apptStatusTab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}<span className="apptStatusCount">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {view === "week"
        ? <div className="apptWeek">
            <div className="apptWeekHead">
              <span className="apptWeekCorner" />
              {week.map(d => {
                const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                return <button type="button" key={d} className={`apptWeekHeadCell${d === date ? " sel" : ""}${d === todayKyiv() ? " today" : ""}`} onClick={() => { setDate(d); setView("day"); }}>
                  <small>{WEEKDAY[dow]}</small><b>{d.slice(8)}</b>
                </button>;
              })}
            </div>
            <div className="apptWeekBody" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
              <div className="apptHours">
                {hours.map(h => <div className="apptHour" key={h} style={{ height: HOUR_PX }}><span>{String(h).padStart(2, "0")}:00</span></div>)}
              </div>
              {week.map(d => (
                <div className="apptWeekCol" key={d}>
                  {Array.from({length:(DAY_END-DAY_START)*2},(_,i)=><div className={`apptSlotLine${i%2===0?" hour":""}`} key={i} style={{top:i*HOUR_PX/2}}><span>{i%2===0?`${String(DAY_START+i/2).padStart(2,"0")}:00`:""}</span></div>)}
                  {weekItems.filter(b => b.desiredDate === d).map(b => eventBlock(b, true))}
                </div>
              ))}
            </div>
          </div>
        : dayItems.length === 0
          ? <div className="apptEmpty"><span aria-hidden="true">🗓</span><p>Записів на цей день немає</p></div>
          : view === "day"
            ? <div className="apptTimeline" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
                <div className="apptHours">
                  {hours.map(h => <div className="apptHour" key={h} style={{ height: HOUR_PX }}><span>{String(h).padStart(2, "0")}:00</span></div>)}
                </div>
                <div className="apptLane">
                  {Array.from({length:(DAY_END-DAY_START)*2},(_,i)=><div className={`apptSlotLine${i%2===0?" hour":""}`} key={i} style={{top:i*HOUR_PX/2}}><span>{i%2===0?`${String(DAY_START+i/2).padStart(2,"0")}:00`:""}</span></div>)}
                  {dayItems.map(b => eventBlock(b, false))}
                </div>
              </div>
            : <div className="apptListWrap">{dayItems.map(b => (
                <div className="apptCardRow" key={b.id}>
                  <span className="apptCardTime">{b.desiredTime || "—"}<small>{b.desiredDate}</small></span>
                  <div className="apptCardBody">
                    <div className="apptCardRoute"><span className={`patientRoute ${b.patientCategory}`}>{b.patientCategory==="military"?"Військовий":"Цивільний"}</span>{b.patientCategory==="civilian"&&<span className={`paymentOverview ${b.paymentStatus==="paid"?"paid":"pending"}`}>{b.paymentStatus==="paid"?"Оплату перевірено":`Перевірити оплату · ${b.paymentAmount || 0} грн`}</span>}</div><b>{b.name || "Без імені"}</b>
                    <span>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doctorOf(b) ? ` · ${doctorOf(b)}` : ""}</span>
                  </div>
                  <span className={`apptBadge grp-${groupOf(b.status)}`}>{stateLabel(b.status)}</span><a className="apptOpenRecord" href={`/staff?open=${b.id}#bookings`}>Відкрити</a>
                </div>
              ))}</div>}
    </div>
  );
}
