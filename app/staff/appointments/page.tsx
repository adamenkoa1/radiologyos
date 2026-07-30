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

// Групи станів під фільтри у стилі DocTime. Реальні дані здебільшого несуть
// legacy-статуси (new/confirmed/rescheduled/completed/cancelled), клінічні
// стани зʼявляються після переходів у реєстрі досліджень.
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
const DAY_START = 8, DAY_END = 18, HOUR_PX = 64;

function todayKyiv(): string {
  // YYYY-MM-DD у Києві без залежностей.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export default function StaffAppointmentsPage() {
  const [staff, setStaff] = useState<StaffOption | null>(null);
  const [items, setItems] = useState<Booking[]>([]);
  const [options, setOptions] = useState<StaffOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [date, setDate] = useState(todayKyiv());
  const [view, setView] = useState<"list" | "day">("list");
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

  const nameByEmail = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of options) map[o.email] = o.displayName || o.email;
    return map;
  }, [options]);

  const dayItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter(b => b.desiredDate === date)
      .filter(b => tab === "all" || GROUPS[tab]?.includes(b.status))
      .filter(b => !q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q))
      .sort((a, b) => (a.desiredTime || "").localeCompare(b.desiredTime || ""));
  }, [items, date, tab, search]);

  const counts = useMemo(() => {
    const onDay = items.filter(b => b.desiredDate === date);
    const out: Record<string, number> = { all: onDay.length };
    for (const t of TABS) if (t.key !== "all") out[t.key] = onDay.filter(b => GROUPS[t.key].includes(b.status)).length;
    return out;
  }, [items, date]);

  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

  function card(b: Booking) {
    const doctor = nameByEmail[b.assignedRadiologistEmail] || nameByEmail[b.assignedRadiographerEmail] || "";
    return (
      <div className="apptCardRow" key={b.id}>
        <span className="apptCardTime">{b.desiredTime || "—"}</span>
        <div className="apptCardBody">
          <b>{b.name || "Без імені"}</b>
          <span>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doctor ? ` · ${doctor}` : ""}</span>
        </div>
        <span className={`apptBadge grp-${groupOf(b.status)}`}>{stateLabel(b.status)}</span>
      </div>
    );
  }

  const body = forbidden
    ? <p className="notice error" role="alert">Доступ лише для персоналу.</p>
    : !loaded
      ? <p className="notice">Завантаження…</p>
      : <div className="apptCal">
          <div className="apptCalBar">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            <input type="search" placeholder="Пошук за пацієнтом…" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="apptViewToggle">
              <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Список</button>
              <button type="button" className={view === "day" ? "active" : ""} onClick={() => setView("day")}>День</button>
            </div>
          </div>
          <div className="apptStatusRow">
            {TABS.map(t => (
              <button type="button" key={t.key} className={`apptStatusTab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
                {t.label}<span className="apptStatusCount">{counts[t.key] ?? 0}</span>
              </button>
            ))}
          </div>

          {dayItems.length === 0
            ? <div className="apptEmpty"><span aria-hidden="true">🗓</span><p>Записів на цей день немає</p></div>
            : view === "list"
              ? <div className="apptListWrap">{dayItems.map(card)}</div>
              : <div className="apptTimeline" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
                  <div className="apptHours">
                    {hours.map(h => <div className="apptHour" key={h} style={{ height: HOUR_PX }}><span>{String(h).padStart(2, "0")}:00</span></div>)}
                  </div>
                  <div className="apptLane">
                    {hours.map(h => <div className="apptLaneLine" key={h} style={{ top: (h - DAY_START) * HOUR_PX }} />)}
                    {dayItems.map(b => {
                      const mins = minutesOf(b.desiredTime);
                      if (mins === null) return null;
                      const top = Math.max(0, ((mins - DAY_START * 60) / 60) * HOUR_PX);
                      const height = Math.max(24, ((b.durationMinutes || 30) / 60) * HOUR_PX - 4);
                      const doctor = nameByEmail[b.assignedRadiologistEmail] || nameByEmail[b.assignedRadiographerEmail] || "";
                      return (
                        <div className={`apptEvent grp-${groupOf(b.status)}`} key={b.id} style={{ top, height }} title={`${b.desiredTime} · ${b.name} · ${b.service}`}>
                          <b>{b.desiredTime} · {b.name || "Без імені"}</b>
                          <span>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}{doctor ? ` · ${doctor}` : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>}
        </div>;

  return (
    <StaffWorkspaceShell
      active="appointments"
      title="Календар записів"
      description="Записи на день — список або таймлайн, із фільтрами за станом."
      staffName={staff?.displayName}
      staffRole={staff?.role}
    >
      {body}
    </StaffWorkspaceShell>
  );
}
