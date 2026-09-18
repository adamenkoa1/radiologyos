"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";
import {
  CALENDAR6_PRESETS,
  SHIFT_OVERRIDE_KINDS,
  datesForMonth,
  resolvePresetShift,
  resolvedOverride,
  shiftCellText,
  shiftPreset,
  type ShiftKind,
  type ShiftOverride,
} from "../../../lib/shift-calendar";

type StaffInfo = { email:string; displayName:string; role:string };
type Person = { email:string; displayName:string; role:string; positionTitle:string; militaryRank:string };
type Assignment = { staffEmail:string; presetCode:string; teamIndex:number; anchorDate:string };
type Override = ShiftOverride & { id:number };
type ApiData = {
  month:string;
  canManage:boolean;
  staff:StaffInfo;
  people:Person[];
  assignments:Assignment[];
  overrides:Override[];
};

const WEEKDAY = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function monthKey(date:Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function moveMonth(value:string, delta:number) {
  const [year, month] = value.split("-").map(Number);
  return monthKey(new Date(year, month - 1 + delta, 1));
}

function dateLabel(value:string) {
  const [year, month, day] = value.split("-").map(Number);
  return WEEKDAY[new Date(year, month - 1, day).getDay()];
}

function monthLabel(value:string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("uk-UA", { month:"long", year:"numeric" }).format(new Date(year, month - 1, 1));
}

export default function StaffShiftsPage() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [data, setData] = useState<ApiData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState("");
  const [presetCode, setPresetCode] = useState(CALENDAR6_PRESETS[0].code);
  const [teamIndex, setTeamIndex] = useState(1);
  const [anchorDate, setAnchorDate] = useState(() => `${monthKey(new Date())}-01`);
  const [selectedDate, setSelectedDate] = useState("");
  const [overrideKind, setOverrideKind] = useState<ShiftKind>("off");
  const [overrideLabel, setOverrideLabel] = useState("");
  const [overrideStart, setOverrideStart] = useState("");
  const [overrideEnd, setOverrideEnd] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  const load = useCallback(async (preferredEmail?:string) => {
    setLoaded(false); setError("");
    try {
      const res = await fetch(`/api/staff/shifts?month=${encodeURIComponent(month)}`, { cache:"no-store" });
      if (res.status === 401 || res.status === 403) { setForbidden(true); return; }
      const body = await res.json().catch(() => ({})) as ApiData & { error?:string };
      if (!res.ok) throw new Error(body.error || "Не вдалося завантажити графік");
      setData(body);
      setForbidden(false);
      const nextEmail = preferredEmail && body.people.some((person) => person.email === preferredEmail)
        ? preferredEmail
        : body.people[0]?.email || "";
      const assignment = body.assignments.find((row) => row.staffEmail === nextEmail);
      setSelectedEmail(nextEmail);
      setPresetCode(assignment?.presetCode || CALENDAR6_PRESETS[0].code);
      setTeamIndex(assignment?.teamIndex || 1);
      setAnchorDate(assignment?.anchorDate || `${month}-01`);
      setSelectedDate("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити графік");
    } finally {
      setLoaded(true);
    }
  }, [month]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const assignments = useMemo(() => new Map((data?.assignments || []).map((row) => [row.staffEmail, row])), [data]);
  const overrides = useMemo(() => new Map((data?.overrides || []).map((row) => [`${row.staffEmail}:${row.shiftDate}`, row])), [data]);
  const dates = useMemo(() => datesForMonth(month), [month]);
  const selectedAssignment = selectedEmail ? assignments.get(selectedEmail) : undefined;
  const selectedPreset = shiftPreset(presetCode);
  const selectedPerson = data?.people.find((person) => person.email === selectedEmail) || null;

  function choosePerson(email:string) {
    const assignment = assignments.get(email);
    setSelectedEmail(email);
    setPresetCode(assignment?.presetCode || CALENDAR6_PRESETS[0].code);
    setTeamIndex(assignment?.teamIndex || 1);
    setAnchorDate(assignment?.anchorDate || `${month}-01`);
    setSelectedDate("");
  }

  function selectDay(person:Person, date:string) {
    choosePerson(person.email);
    setSelectedDate(date);
    const existing = overrides.get(`${person.email}:${date}`);
    const assignment = assignments.get(person.email);
    const computed = assignment
      ? resolvePresetShift(assignment.presetCode, assignment.teamIndex, assignment.anchorDate, date)
      : null;
    setOverrideKind(existing?.kind || computed?.kind || "off");
    setOverrideLabel(existing?.label || computed?.label || "");
    setOverrideStart(existing?.startTime || computed?.start || "");
    setOverrideEnd(existing?.endTime || computed?.end || "");
    setOverrideNote(existing?.note || "");
    setNotice(""); setError("");
  }

  async function action(payload:Record<string, unknown>) {
    setSaving(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/staff/shifts", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({})) as { ok?:boolean; error?:string };
      if (!res.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти");
      await load(selectedEmail);
      setNotice("Графік збережено.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAssignment(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmail) return;
    await action({ action:"assignment", staffEmail:selectedEmail, presetCode, teamIndex, anchorDate });
  }

  async function clearAssignment() {
    if (!selectedEmail) return;
    const ok = await action({ action:"clear_assignment", staffEmail:selectedEmail });
    if (ok) setSelectedDate("");
  }

  async function saveOverride(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmail || !selectedDate) return;
    await action({
      action:"override", staffEmail:selectedEmail, shiftDate:selectedDate,
      kind:overrideKind, label:overrideLabel, startTime:overrideStart,
      endTime:overrideEnd, note:overrideNote,
    });
  }

  async function clearOverride() {
    if (!selectedEmail || !selectedDate) return;
    const ok = await action({ action:"clear_override", staffEmail:selectedEmail, shiftDate:selectedDate });
    if (ok) setSelectedDate("");
  }

  const configuredCount = data?.assignments.length || 0;
  const today = new Date().toISOString().slice(0, 10);

  const content = forbidden
    ? <p className="notice error" role="alert">Графік змін доступний лише персоналу цієї організації.</p>
    : !loaded
      ? <p className="notice">Завантаження графіка…</p>
      : <div className="shiftPlanner">
          <section className="shiftPlannerSummary">
            <article><small>Працівники</small><b>{data?.people.length || 0}</b><span>{data?.canManage ? "активні у tenant" : "ваш профіль"}</span></article>
            <article><small>Налаштовано</small><b>{configuredCount}</b><span>мають циклічний графік</span></article>
            <article><small>Корекції місяця</small><b>{data?.overrides.length || 0}</b><span>відпустки, заміни, вихідні</span></article>
          </section>

          <section className="shiftPlannerToolbar">
            <div className="shiftMonthNav">
              <button type="button" onClick={() => setMonth(moveMonth(month, -1))} aria-label="Попередній місяць">‹</button>
              <button type="button" onClick={() => setMonth(monthKey(new Date()))}>Сьогодні</button>
              <b>{monthLabel(month)}</b>
              <button type="button" onClick={() => setMonth(moveMonth(month, 1))} aria-label="Наступний місяць">›</button>
            </div>
            <div className="shiftPlannerActions">
              <a className="button secondary" href={`/api/staff/shifts?month=${encodeURIComponent(month)}&format=csv`}>CSV</a>
              <button type="button" className="button secondary" onClick={() => window.print()}>Друк</button>
            </div>
          </section>

          {data?.canManage && <section className="shiftPlannerEditor">
            <form className="shiftAssignmentForm" onSubmit={saveAssignment}>
              <div className="shiftEditorHead"><div><h3>Циклічний графік працівника</h3><p>Пресети відтворені з Calendar6. Опорна дата відповідає першому стовпцю матриці обраної бригади.</p></div></div>
              <div className="shiftEditorGrid">
                <label><span>Працівник</span><select value={selectedEmail} onChange={(e) => choosePerson(e.target.value)}>{(data?.people || []).map((person) => <option key={person.email} value={person.email}>{person.displayName || person.email}</option>)}</select></label>
                <label><span>Тип графіка</span><select value={presetCode} onChange={(e) => { setPresetCode(e.target.value); setTeamIndex(1); }}>{CALENDAR6_PRESETS.map((preset) => <option key={preset.code} value={preset.code}>{preset.name}</option>)}</select></label>
                <label><span>Бригада / фаза</span><select value={teamIndex} onChange={(e) => setTeamIndex(Number(e.target.value))}>{Array.from({ length:selectedPreset?.teams.length || 0 }, (_, index) => <option key={index + 1} value={index + 1}>Бригада {index + 1}</option>)}</select></label>
                <label><span>Опорна дата</span><input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} required /></label>
              </div>
              {selectedPreset?.sourceWarning && <p className="notice warning">{selectedPreset.sourceWarning}</p>}
              <div className="shiftEditorButtons"><button className="button primary" disabled={saving || !selectedEmail} type="submit">{saving ? "Збереження…" : "Зберегти графік"}</button>{selectedAssignment && <button className="button ghost" type="button" disabled={saving} onClick={() => void clearAssignment()}>Прибрати графік</button>}</div>
            </form>

            <form className="shiftOverrideForm" onSubmit={saveOverride}>
              <div><h3>Персональна корекція дня</h3><p>{selectedDate ? `${selectedPerson?.displayName || "Працівник"} · ${selectedDate}` : "Натисніть день у таблиці нижче."}</p></div>
              {selectedDate && <>
                <div className="shiftEditorGrid overrideGrid">
                  <label><span>Тип</span><select value={overrideKind} onChange={(e) => setOverrideKind(e.target.value as ShiftKind)}>{SHIFT_OVERRIDE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label><span>Позначка</span><input value={overrideLabel} maxLength={24} onChange={(e) => setOverrideLabel(e.target.value)} placeholder="Напр. Вп" /></label>
                  <label><span>З</span><input type="time" value={overrideStart} onChange={(e) => setOverrideStart(e.target.value)} /></label>
                  <label><span>До</span><input type="time" value={overrideEnd} onChange={(e) => setOverrideEnd(e.target.value)} /></label>
                  <label className="shiftNoteField"><span>Примітка</span><input value={overrideNote} maxLength={240} onChange={(e) => setOverrideNote(e.target.value)} placeholder="Без медичних даних" /></label>
                </div>
                <div className="shiftEditorButtons"><button className="button primary" disabled={saving} type="submit">Застосувати корекцію</button>{overrides.has(`${selectedEmail}:${selectedDate}`) && <button className="button ghost" type="button" disabled={saving} onClick={() => void clearOverride()}>Повернути цикл</button>}</div>
              </>}
            </form>
          </section>}

          {notice && <p className="notice success" role="status">{notice}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}

          <section className="shiftCalendarCard">
            <div className="shiftCalendarIntro"><div><h3>Табель змін · {monthLabel(month)}</h3><p>Клік по дню відкриває персональну корекцію. Жирна крапка означає ручний виняток від циклу.</p></div><div className="shiftLegend"><span className="day">Д</span><small>день</small><span className="night">Н</span><small>ніч</small><span className="off">В</span><small>вихідний</small><span className="leave">Вп</span><small>відпустка</small></div></div>
            <div className="shiftTableWrap">
              <table className="shiftTable">
                <thead><tr><th className="shiftPersonColumn">Працівник</th>{dates.map((date) => <th key={date} className={date === today ? "today" : ""}><b>{date.slice(-2)}</b><small>{dateLabel(date)}</small></th>)}</tr></thead>
                <tbody>{(data?.people || []).map((person) => {
                  const assignment = assignments.get(person.email);
                  const preset = assignment ? shiftPreset(assignment.presetCode) : null;
                  return <tr key={person.email}>
                    <th className="shiftPersonColumn"><b>{person.displayName || person.email}</b><small>{[person.militaryRank, person.positionTitle].filter(Boolean).join(" · ") || roleLabelUk(person.role)}</small><span>{preset ? `${preset.name} · бригада ${assignment?.teamIndex}` : "Графік не призначено"}</span></th>
                    {dates.map((date) => {
                      const override = overrides.get(`${person.email}:${date}`);
                      const base = assignment ? resolvePresetShift(assignment.presetCode, assignment.teamIndex, assignment.anchorDate, date) : null;
                      const shift = override ? resolvedOverride(override) : base;
                      const title = `${date} · ${shiftCellText(shift)}${shift?.note ? ` · ${shift.note}` : ""}`;
                      return <td key={date} className={`${date === today ? "today " : ""}${shift ? `kind-${shift.kind}` : "kind-empty"}${override ? " manual" : ""}`}>
                        <button type="button" disabled={!data?.canManage} onClick={() => selectDay(person, date)} title={title} aria-label={`${person.displayName || person.email}, ${date}: ${shiftCellText(shift)}`}>
                          <b>{shift?.label || "—"}</b>{shift?.start || shift?.end ? <small>{shift?.start || "?"}<br />{shift?.end || "?"}</small> : null}{override && <i aria-label="Ручна корекція">•</i>}
                        </button>
                      </td>;
                    })}
                  </tr>;
                })}</tbody>
              </table>
            </div>
            {(data?.people.length || 0) === 0 && <p className="empty">У цій організації немає активних працівників.</p>}
          </section>
        </div>;

  return <StaffWorkspaceShell
    active="schedule"
    title="Графік змін персоналу"
    description="Циклічні графіки, бригади, денні/нічні зміни та персональні корекції — сучасна веб-версія логіки Calendar6."
    staffName={data?.staff.displayName}
    staffRole={roleLabelUk(data?.staff.role)}
  >{content}</StaffWorkspaceShell>;
}
