"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { stateLabel } from "../../../lib/study-state";

type Booking = {
  id: number; code: string; name: string; phone: string; service: string;
  equipmentId: string; durationMinutes: number; desiredDate: string; desiredTime: string;
  status: string; patientCategory: string;
  assignedRadiologistEmail: string; assignedRadiographerEmail: string;
};
type StaffOption = { email: string; displayName: string; role: string };
type View = "list" | "day" | "week";

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
const DAY_START = 8, DAY_END = 19, HOUR_PX = 56;

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

export default function StaffAppointmentsPage() {
  const [staff, setStaff] = useState<StaffOption | null>(null);
  const [items, setItems] = useState<Booking[]>([]);
  const [options, setOptions] = useState<StaffOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [date, setDate] = useState(todayKyiv());
  const [view, setView] = useState<View>("week");
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/staff/bookings", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) { if (active) setForbidden(true); return; }
      const data = await res.json().catch(() => ({})) as { bookings?: Booking[]; staffOptions?: StaffOption[]; staff?: StaffOption };
      if (!active) return;
      setItems(data.bookings || []);
      setOptions(data.staffOptions || []);
      if (data.staff) setStaff(data.staff);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  // Дозволяємо відкрити календар на конкретній даті/вигляді (напр. після
  // підтвердження запису: /staff/appointments?date=…&view=week).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      const v = p.get("view"); const d = p.get("date");
      if (v === "day" || v === "week" || v === "list") setView(v);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const nameByEmail = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of options) map[o.email] = o.displayName || o.email;
    return map;
  }, [options]);

  const q = search.trim().toLowerCase();

  const dayItems = useMemo(() => items
    .filter(b => b.desiredDate === date && ((tab === "all" || GROUPS[tab]?.includes(b.status)) && (!q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q))))
    .sort((a, b) => (a.desiredTime || "").localeCompare(b.desiredTime || "")),
  [items, date, tab, q]);

  const week = useMemo(() => weekDates(date), [date]);
  const weekItems = useMemo(() => items.filter(b => week.includes(b.desiredDate)
    && ((tab === "all" || GROUPS[tab]?.includes(b.status)) && (!q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q)))),
  [items, week, tab, q]);

  const counts = useMemo(() => {
    const scope = view === "week" ? items.filter(b => week.includes(b.desiredDate)) : items.filter(b => b.desiredDate === date);
    const out: Record<string, number> = { all: scope.length };
    for (const t of TABS) if (t.key !== "all") out[t.key] = scope.filter(b => GROUPS[t.key].includes(b.status)).length;
    return out;
  }, [items, date, week, view]);

  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  const doctorOf = (b: Booking) => nameByEmail[b.assignedRadiologistEmail] || nameByEmail[b.assignedRadiographerEmail] || "";

  function eventBlock(b: Booking, compact: boolean) {
    const mins = minutesOf(b.desiredTime);
    if (mins === null) return null;
    const top = Math.max(0, ((mins - DAY_START * 60) / 60) * HOUR_PX);
    const height = Math.max(compact ? 20 : 24, ((b.durationMinutes || 30) / 60) * HOUR_PX - 3);
    return (
      <div className={`apptEvent grp-${groupOf(b.status)}`} key={b.id} style={{ top, height }} title={`${b.desiredTime} · ${b.name} · ${b.service}`}>
        <b>{b.desiredTime} {b.name || "Без імені"}</b>
        {!compact && <span>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doctorOf(b) ? ` · ${doctorOf(b)}` : ""}</span>}
        {compact && <span>{EQUIP[b.equipmentId] || b.service}</span>}
      </div>
    );
  }

  const rangeLabel = view === "week"
    ? `${week[0].slice(8)}–${week[6].slice(8)}.${week[0].slice(5, 7)}`
    : date;

  const body = forbidden
    ? <p className="notice error" role="alert">Доступ лише для персоналу.</p>
    : !loaded
      ? <p className="notice">Завантаження…</p>
      : <div className="apptCal">
          <div className="apptCalBar">
            <div className="apptNav">
              <button type="button" onClick={() => setDate(addDays(date, view === "week" ? -7 : -1))} aria-label="Назад">‹</button>
              <button type="button" className="apptToday" onClick={() => setDate(todayKyiv())}>Сьогодні</button>
              <button type="button" onClick={() => setDate(addDays(date, view === "week" ? 7 : 1))} aria-label="Вперед">›</button>
              <span className="apptRange">{rangeLabel}</span>
            </div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            <input type="search" placeholder="Пошук за пацієнтом…" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="apptViewToggle">
              <button type="button" className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Тиждень</button>
              <button type="button" className={view === "day" ? "active" : ""} onClick={() => setView("day")}>День</button>
              <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Список</button>
            </div>
            <a className="apptNewBtn" href="/staff/book">+ Нова запис</a>
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
                      {hours.map(h => <div className="apptLaneLine" key={h} style={{ top: (h - DAY_START) * HOUR_PX }} />)}
                      {weekItems.filter(b => b.desiredDate === d).map(b => eventBlock(b, true))}
                    </div>
                  ))}
                </div>
              </div>
            : (view === "day" ? dayItems : dayItems).length === 0
              ? <div className="apptEmpty"><span aria-hidden="true">🗓</span><p>Записів на цей день немає</p></div>
              : view === "day"
                ? <div className="apptTimeline" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
                    <div className="apptHours">
                      {hours.map(h => <div className="apptHour" key={h} style={{ height: HOUR_PX }}><span>{String(h).padStart(2, "0")}:00</span></div>)}
                    </div>
                    <div className="apptLane">
                      {hours.map(h => <div className="apptLaneLine" key={h} style={{ top: (h - DAY_START) * HOUR_PX }} />)}
                      {dayItems.map(b => eventBlock(b, false))}
                    </div>
                  </div>
                : <div className="apptListWrap">{dayItems.map(b => (
                    <div className="apptCardRow" key={b.id}>
                      <span className="apptCardTime">{b.desiredTime || "—"}</span>
                      <div className="apptCardBody">
                        <b>{b.name || "Без імені"}</b>
                        <span>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doctorOf(b) ? ` · ${doctorOf(b)}` : ""}</span>
                      </div>
                      <span className={`apptBadge grp-${groupOf(b.status)}`}>{stateLabel(b.status)}</span>
                    </div>
                  ))}</div>}
        </div>;

  return (
    <StaffWorkspaceShell
      active="appointments"
      title="Календар записів"
      description="Тиждень, день або список — із фільтрами за станом."
      staffName={staff?.displayName}
      staffRole={staff?.role}
    >
      {body}
    </StaffWorkspaceShell>
  );
}
