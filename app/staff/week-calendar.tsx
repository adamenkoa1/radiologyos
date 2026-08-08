"use client";

// Спільний тижневий календар записів. Використовується і на окремій сторінці
// «Календар записів», і в пульті відділення (об'єднаний перегляд). Компонент
// презентаційний: дані (bookings, staffOptions) приходять пропсами, а стан
// вигляду/дати/фільтра — локальний.

import { useCallback, useMemo, useState } from "react";
import BookingDrawer from "./booking-drawer";
import { stateLabel } from "../../lib/study-state";
import { candidateTimesFor, EQUIP_KEYS, EQUIP_LABELS, isEquipmentDayOpen, SCHEDULE_DEFAULTS, type ScheduleConfig } from "../../lib/schedule";

export type CalBooking = {
  id: number; code: string; name: string; phone: string; service: string;
  equipmentId: string; durationMinutes: number; desiredDate: string; desiredTime: string;
  status: string; patientCategory?: string; paymentStatus?: string; paymentAmount?: number; paidAmount?: number;
  assignedRadiologistEmail?: string; assignedRadiographerEmail?: string;
};
export type CalStaffOption = { email: string; displayName: string; role: string };
export type CalEquipmentBlock = { id:number; equipmentId:string; blockedDate:string; startTime:string; endTime:string; reason:string };
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

// Розкладка подій дня по «доріжках»: події, що перетинаються в часі,
// діляться на колонки (як у Google Calendar), щоб не малюватися одна поверх
// одної. Повертає для кожного id { lane, lanes } — індекс і кількість колонок
// у його кластері накладань.
function laneLayout(events: CalBooking[]): Map<number, { lane: number; lanes: number }> {
  const out = new Map<number, { lane: number; lanes: number }>();
  const items = events
    .map(b => { const s = minutesOf(b.desiredTime) ?? 0; return { id: b.id, s, e: s + (b.durationMinutes || 30) }; })
    .sort((a, b) => a.s - b.s || a.e - b.e);
  let cluster: Array<{ id: number; s: number; e: number; lane: number }> = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const it of cluster) {
      let li = laneEnds.findIndex(end => end <= it.s);
      if (li === -1) { li = laneEnds.length; laneEnds.push(it.e); } else { laneEnds[li] = it.e; }
      it.lane = li;
    }
    const lanes = laneEnds.length;
    for (const it of cluster) out.set(it.id, { lane: it.lane, lanes });
    cluster = []; clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push({ ...it, lane: 0 });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return out;
}

function nowMinutesKyiv(): number {
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return minutesOf(hm) ?? -1;
}

export default function WeekCalendar({
  bookings, options = [], schedule = SCHEDULE_DEFAULTS, blocks = [], initialView = "day", initialDate,
}: {
  bookings: CalBooking[];
  options?: CalStaffOption[];
  schedule?: ScheduleConfig;
  blocks?: CalEquipmentBlock[];
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
  const matchesExtra = useCallback((b: CalBooking) =>
    (category === "all" || b.patientCategory === category)
    && (payment === "all" || (payment === "paid" ? b.paymentStatus === "paid" : b.patientCategory === "civilian" && b.paymentStatus !== "paid")),
  [category, payment]);

  const dayItems = useMemo(() => bookings
    .filter(b => b.desiredDate === date && matchesExtra(b) && ((tab === "all" || GROUPS[tab]?.includes(b.status)) && (!q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q))))
    .sort((a, b) => (a.desiredTime || "").localeCompare(b.desiredTime || "")),
  [bookings, date, tab, q, matchesExtra]);

  const week = useMemo(() => weekDates(date), [date]);
  const weekItems = useMemo(() => bookings.filter(b => week.includes(b.desiredDate) && matchesExtra(b)
    && ((tab === "all" || GROUPS[tab]?.includes(b.status)) && (!q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q)))),
  [bookings, week, tab, q, matchesExtra]);

  // Лічильники вкладок рахуємо на вже відфільтрованій вибірці (категорія,
  // оплата, пошук), щоб числа збігалися з тим, що реально показано.
  const counts = useMemo(() => {
    const inScope = (b: CalBooking) =>
      (view === "week" ? week.includes(b.desiredDate) : b.desiredDate === date)
      && matchesExtra(b)
      && (!q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q));
    const scope = bookings.filter(inScope);
    const out: Record<string, number> = { all: scope.length };
    for (const t of TABS) if (t.key !== "all") out[t.key] = scope.filter(b => GROUPS[t.key].includes(b.status)).length;
    return out;
  }, [bookings, date, week, view, matchesExtra, q]);

  // Фільтри й вкладки стосуються заявок; у вигляді «День» (дошка вільних слотів
  // кабінетів) вони не застосовуються — тому там їх не показуємо.
  const filtersApply = view === "week" || view === "list";

  // Єдиний Workspace: клік по запису відкриває контекст у правій панелі, без
  // переходу на іншу сторінку. Спільний компонент BookingDrawer.
  const [openId, setOpenId] = useState<number | null>(null);
  const openBooking = useMemo(() => bookings.find(b => b.id === openId) || null, [bookings, openId]);

  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  const doctorOf = (b: CalBooking) => nameByEmail[b.assignedRadiologistEmail || ""] || nameByEmail[b.assignedRadiographerEmail || ""] || "";
  // Кольорова смужка за типом дослідження + контраст — розпізнавання за мить.
  const modClass = (equipmentId: string) => `mod-${equipmentId || "other"}`;
  const isContrast = (b: CalBooking) => /контраст|ангіограф/i.test(b.service || "");

  function eventBlock(b: CalBooking, compact: boolean, pos?: { lane: number; lanes: number }) {
    const mins = minutesOf(b.desiredTime);
    if (mins === null) return null;
    const top = Math.max(0, ((mins - DAY_START * 60) / 60) * HOUR_PX);
    const height = Math.max(compact ? 20 : 24, ((b.durationMinutes || 30) / 60) * HOUR_PX - 3);
    // Ділимо ширину колонки між подіями, що накладаються.
    const lanes = pos && pos.lanes > 1 ? pos.lanes : 1;
    const laneStyle = lanes > 1
      ? { left: `calc(${(pos!.lane * 100) / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, right: "auto" as const }
      : {};
    return (
      <button type="button" onClick={()=>setOpenId(b.id)} className={`apptEvent grp-${groupOf(b.status)} route-${b.patientCategory || "unknown"} ${b.paymentStatus==="paid"?"paid":"unpaid"}`} key={b.id} style={{ top, height, ...laneStyle }} title={`${b.desiredTime} · ${b.name} · ${b.service}`}>
        <b>{b.desiredTime} {b.name || "Без імені"}</b>
        {!compact && <span>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doctorOf(b) ? ` · ${doctorOf(b)}` : ""}</span>}
        {compact && <span>{EQUIP[b.equipmentId] || b.service}</span>}
        <em>{b.patientCategory==="military"?"Військовий":b.paymentStatus==="paid"?"Оплачено":"Цивільний · перевірити оплату"}</em>
      </button>
    );
  }

  function roomSlot(equipmentId:string,time:string) {
    const start = minutesOf(time) || 0;
    const step = schedule.equipment[equipmentId]?.slotMinutes || 15;
    const end = start + step;
    const occupied = bookings.find(b => b.desiredDate === date && b.equipmentId === equipmentId
      && !["cancelled","no_show"].includes(b.status)
      && (minutesOf(b.desiredTime) || 0) < end
      && (minutesOf(b.desiredTime) || 0) + (b.durationMinutes || step) > start);
    const blocked = blocks.find(b => b.blockedDate === date && b.equipmentId === equipmentId
      && (minutesOf(b.startTime) || 0) < end && (minutesOf(b.endTime) || 0) > start);
    return { occupied, blocked };
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
        {filtersApply && <>
          <select aria-label="Категорія пацієнта" value={category} onChange={e=>setCategory(e.target.value)}>
            <option value="all">Усі пацієнти</option><option value="military">Військові</option><option value="civilian">Цивільні</option>
          </select>
          <select aria-label="Оплата" value={payment} onChange={e=>setPayment(e.target.value)}>
            <option value="all">Будь-яка оплата</option><option value="pending">Перевірити оплату</option><option value="paid">Оплату перевірено</option>
          </select>
          <input type="search" placeholder="Пошук за пацієнтом…" value={search} onChange={e => setSearch(e.target.value)} />
        </>}
        <div className="apptViewToggle">
          <button type="button" className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Тиждень</button>
          <button type="button" className={view === "day" ? "active" : ""} onClick={() => setView("day")}>День</button>
          <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Список</button>
        </div>
        <a className="apptNewBtn" href="/staff/book">+ Записати пацієнта</a>
      </div>
      {filtersApply && <div className="apptStatusRow">
        {TABS.map(t => (
          <button type="button" key={t.key} className={`apptStatusTab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}<span className="apptStatusCount">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>}
      {view === "day" && <p className="slotBoardHint">Натисніть зелений вільний слот, щоб одразу записати пацієнта на цей кабінет, дату і час.</p>}

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
              {(() => { const now = nowMinutesKyiv(); const tk = todayKyiv(); return week.map(d => {
                const dayEvs = weekItems.filter(b => b.desiredDate === d);
                const lay = laneLayout(dayEvs);
                const showNow = d === tk && now >= DAY_START * 60 && now <= DAY_END * 60;
                return <div className="apptWeekCol" key={d}>
                  {Array.from({length:(DAY_END-DAY_START)*2},(_,i)=><div className={`apptSlotLine${i%2===0?" hour":""}`} key={i} style={{top:i*HOUR_PX/2}}><span>{i%2===0?`${String(DAY_START+i/2).padStart(2,"0")}:00`:""}</span></div>)}
                  {showNow && <div className="apptNowLine" style={{ top: ((now - DAY_START * 60) / 60) * HOUR_PX }} aria-hidden="true" />}
                  {dayEvs.map(b => eventBlock(b, true, lay.get(b.id)))}
                </div>;
              }); })()}
            </div>
          </div>
        : view === "day"
          ? <div className="roomSlotBoard">
              <div className="slotLegend"><span><i className="free"/>Вільно</span><span><i className="occupied"/>Зайнято</span><span><i className="blocked"/>Недоступно</span></div>
              <div className="roomSlotColumns">
                {EQUIP_KEYS.map(equipmentId => <section className="roomSlotColumn" key={equipmentId}>
                  <header><b>{EQUIP_LABELS[equipmentId]}</b><span>крок {schedule.equipment[equipmentId]?.slotMinutes || 15} хв</span></header>
                  {!isEquipmentDayOpen(date,schedule,equipmentId)
                    ? <p className="roomClosed">Кабінет цього дня не працює</p>
                    : <div className="roomSlots">{candidateTimesFor(schedule.equipment[equipmentId] || SCHEDULE_DEFAULTS.equipment[equipmentId], schedule.equipment[equipmentId]?.slotMinutes || 15).map(time => {
                        const state=roomSlot(equipmentId,time);
                        if(state.occupied) { const occ = state.occupied; return <button type="button" onClick={()=>setOpenId(occ.id)} className={`roomSlot occupied route-${occ.patientCategory || "unknown"}`} key={time}><strong>{time}</strong><span>{occ.name}</span><small>{occ.service}</small></button>; }
                        if(state.blocked) return <span className="roomSlot blocked" key={time} title={state.blocked.reason}><strong>{time}</strong><span>Недоступно</span><small>{state.blocked.reason || "Технічне вікно"}</small></span>;
                        return <a className="roomSlot free" href={`/staff/book?date=${date}&time=${time}&equipment=${equipmentId}`} key={time}><strong>{time}</strong><span>Вільний слот</span></a>;
                      })}</div>}
                </section>)}
              </div>
            </div>
          : dayItems.length === 0
            ? <div className="apptEmpty"><span aria-hidden="true">🗓</span><p>Записів на цей день немає</p></div>
            : <div className="apptListWrap">{dayItems.map(b => (
                <button type="button" className={`apptCardRow ${modClass(b.equipmentId)}`} key={b.id} onClick={()=>setOpenId(b.id)}>
                  <span className="apptCardTime">{b.desiredTime || "—"}<small>{b.desiredDate}</small></span>
                  <div className="apptCardBody">
                    <b className="apptCardName">{b.name || "Без імені"}</b>
                    <span className="apptCardMeta">{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doctorOf(b) ? ` · 👨‍⚕️ ${doctorOf(b)}` : ""}</span>
                  </div>
                  <div className="apptCardTags">
                    {isContrast(b) && <span className="apptTag contrast">Контраст</span>}
                    {b.patientCategory==="military"
                      ? <span className="apptTag mil">Військовий</span>
                      : b.paymentStatus==="paid"
                        ? <span className="apptTag paid">Оплачено</span>
                        : <span className="apptTag pay">Перевірити оплату</span>}
                  </div>
                  <span className={`apptBadge grp-${groupOf(b.status)}`}>{stateLabel(b.status)}</span>
                  <span className="apptOpenRecord" aria-hidden="true">Відкрити</span>
                </button>
              ))}</div>}

      {openBooking && <BookingDrawer
        booking={openBooking}
        all={bookings}
        doctorName={doctorOf(openBooking)}
        onClose={()=>setOpenId(null)}
        onOpen={setOpenId}
      />}
    </div>
  );
}
