"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { EQUIP_KEYS, EQUIP_LABELS, SCHEDULE_DEFAULTS, type ScheduleConfig } from "../../../lib/schedule";

type StaffInfo = { email: string; displayName: string; role: string };
const WEEKDAYS: [number, string][] = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"]];

export default function StaffSchedulePage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cfg, setCfg] = useState<ScheduleConfig>(() => JSON.parse(JSON.stringify(SCHEDULE_DEFAULTS)));
  const [newDay, setNewDay] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const t = window.setTimeout(async () => {
      const res = await fetch("/api/staff/schedule", { cache: "no-store" });
      if (res.status === 403) { if (active) setForbidden(true); return; }
      const data = await res.json().catch(() => ({})) as { schedule?: ScheduleConfig; staff?: StaffInfo };
      if (!active) return;
      if (data.schedule) setCfg({ ...JSON.parse(JSON.stringify(SCHEDULE_DEFAULTS)), ...data.schedule });
      if (data.staff) setStaff(data.staff);
      setLoaded(true);
    }, 0);
    return () => { active = false; window.clearTimeout(t); };
  }, []);

  function setHours(key: string, field: "start" | "end" | "slotMinutes", value: string) {
    setCfg(prev => ({ ...prev, equipment: { ...prev.equipment, [key]: { ...prev.equipment[key], [field]: field === "slotMinutes" ? Number(value) : value } } }));
  }
  function toggleWeekday(d: number) {
    setCfg(prev => ({ ...prev, weekdays: prev.weekdays.includes(d) ? prev.weekdays.filter(x => x !== d) : [...prev.weekdays, d].sort((a, b) => a - b) }));
  }
  function addDayOff() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDay) || cfg.daysOff.includes(newDay)) return;
    setCfg(prev => ({ ...prev, daysOff: [...prev.daysOff, newDay].sort() }));
    setNewDay("");
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

  const body = forbidden
    ? <p className="notice error" role="alert">Графік налаштовує лише адміністратор.</p>
    : !loaded
      ? <p className="notice">Завантаження…</p>
      : <form className="settingsCard" onSubmit={save}>
          <section className="settingsBlock">
            <h3>Робочі дні тижня</h3>
            <p className="settingsHint">Неділя завжди закрита. Зніміть галочку, щоб закрити ще якийсь день.</p>
            <div className="weekdayRow">
              {WEEKDAYS.map(([d, label]) => (
                <label key={d} className={`weekdayChip${cfg.weekdays.includes(d) ? " on" : ""}`}>
                  <input type="checkbox" checked={cfg.weekdays.includes(d)} onChange={() => toggleWeekday(d)} />{label}
                </label>
              ))}
            </div>
          </section>

          <section className="settingsBlock">
            <h3>Години прийому та крок слота</h3>
            <p className="settingsHint">Для кожного апарата окремо. Крок — інтервал між слотами у хвилинах.</p>
            {EQUIP_KEYS.map(key => (
              <div className="equipHoursRow" key={key}>
                <b>{EQUIP_LABELS[key]}</b>
                <label><span>З</span><input type="time" value={cfg.equipment[key].start} onChange={e => setHours(key, "start", e.target.value)} /></label>
                <label><span>До</span><input type="time" value={cfg.equipment[key].end} onChange={e => setHours(key, "end", e.target.value)} /></label>
                <label><span>Крок, хв</span><input type="number" min={5} max={240} step={5} value={cfg.equipment[key].slotMinutes} onChange={e => setHours(key, "slotMinutes", e.target.value)} /></label>
              </div>
            ))}
          </section>

          <section className="settingsBlock">
            <h3>Вихідні та свята</h3>
            <p className="settingsHint">Конкретні дати, коли запис недоступний.</p>
            <div className="dayOffAdd">
              <input type="date" value={newDay} onChange={e => setNewDay(e.target.value)} />
              <button type="button" className="button secondary" onClick={addDayOff}>Додати</button>
            </div>
            {cfg.daysOff.length > 0 && <ul className="dayOffList">{cfg.daysOff.map(d => (
              <li key={d}>{d}<button type="button" onClick={() => setCfg(prev => ({ ...prev, daysOff: prev.daysOff.filter(x => x !== d) }))}>×</button></li>
            ))}</ul>}
          </section>

          {notice && <p className="notice success" role="status">{notice}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
          <div className="settingsActions">
            <button type="submit" disabled={status === "saving"}>{status === "saving" ? "Зберігаємо…" : "Зберегти графік"}</button>
            <a className="textLink" href="/staff/appointments">До календаря</a>
          </div>
        </form>;

  return (
    <StaffWorkspaceShell active="schedule" title="Графік і слоти" description="Години прийому, крок слота, робочі дні та вихідні — керує адміністратор." staffName={staff?.displayName} staffRole={staff?.role}>
      {body}
    </StaffWorkspaceShell>
  );
}
