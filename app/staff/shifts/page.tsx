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
type Person = {
  personnelId:string; email:string; accountEmail:string | null; displayName:string; role:string;
  positionTitle:string; militaryRank:string; departmentName:string;
};
type Assignment = { personnelId:string; staffEmail:string; presetCode:string; teamIndex:number; anchorDate:string };
type Override = ShiftOverride & { id:number; personnelId:string };
type ApiData = {
  month:string; canManage:boolean; personnelLinked:boolean; staff:StaffInfo; people:Person[];
  assignments:Assignment[]; overrides:Override[];
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
  const [selectedPersonnelId, setSelectedPersonnelId] = useState("");
  const [presetCode, setPresetCode] = useState(CALENDAR6_PRESETS[0].code);
  const [teamIndex, setTeamIndex] = useState(1);
  const [anchorDate, setAnchorDate] = useState(() => `${monthKey(new Date())}-01`);
  const [selectedDate, setSelectedDate] = useState("");
  const [overrideKind, setOverrideKind] = useState<ShiftKind>("off");
  const [overrideLabel, setOverrideLabel] = useState("");
  const [overrideStart, setOverrideStart] = useState("");
  const [overrideEnd, setOverrideEnd] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  const load = useCallback(async (preferredPersonnelId?:string) => {
    setLoaded(false); setError("");
    try {
      const res = await fetch(`/api/staff/shifts?month=${encodeURIComponent(month)}`, { cache:"no-store" });
      if (res.status === 401 || res.status === 403) { setForbidden(true); return; }
      const body = await res.json().catch(() => ({})) as ApiData & { error?:string };
      if (!res.ok) throw new Error(body.error || "Не вдалося завантажити графік");
      setData(body); setForbidden(false);
      const nextId = preferredPersonnelId && body.people.some((person) => person.personnelId === preferredPersonnelId)
        ? preferredPersonnelId : body.people[0]?.personnelId || "";
      const assignment = body.assignments.find((row) => row.personnelId === nextId);
      setSelectedPersonnelId(nextId);
      setPresetCode(assignment?.presetCode || CALENDAR6_PRESETS[0].code);
      setTeamIndex(assignment?.teamIndex || 1);
      setAnchorDate(assignment?.anchorDate || `${month}-01`);
      setSelectedDate("");
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося завантажити графік"); }
    finally { setLoaded(true); }
  }, [month]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const assignments = useMemo(() => new Map((data?.assignments || []).map((row) => [row.personnelId, row])), [data]);
  const overrides = useMemo(() => new Map((data?.overrides || []).map((row) => [`${row.personnelId}:${row.shiftDate}`, row])), [data]);
  const dates = useMemo(() => datesForMonth(month), [month]);
  const selectedAssignment = selectedPersonnelId ? assignments.get(selectedPersonnelId) : undefined;
  const selectedPreset = shiftPreset(presetCode);
  const selectedPerson = data?.people.find((person) => person.personnelId === selectedPersonnelId) || null;

  function choosePerson(personnelId:string) {
    const assignment = assignments.get(personnelId);
    setSelectedPersonnelId(personnelId);
    setPresetCode(assignment?.presetCode || CALENDAR6_PRESETS[0].code);
    setTeamIndex(assignment?.teamIndex || 1);
    setAnchorDate(assignment?.anchorDate || `${month}-01`);
    setSelectedDate("");
  }

  function selectDay(person:Person, date:string) {
    choosePerson(person.personnelId); setSelectedDate(date);
    const existing = overrides.get(`${person.personnelId}:${date}`);
    const assignment = assignments.get(person.personnelId);
    const computed = assignment ? resolvePresetShift(assignment.presetCode, assignment.teamIndex, assignment.anchorDate, date) : null;
    setOverrideKind(existing?.kind || computed?.kind || "off");
    setOverrideLabel(existing?.label || computed?.label || "");
    setOverrideStart(existing?.startTime || computed?.start || "");
    setOverrideEnd(existing?.endTime || computed?.end || "");
    setOverrideNote(existing?.note || ""); setNotice(""); setError("");
  }

  async function action(payload:Record<string, unknown>) {
    setSaving(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/staff/shifts", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
      const body = await res.json().catch(() => ({})) as {ok?:boolean;error?:string};
      if (!res.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти");
      await load(selectedPersonnelId); setNotice("Графік збережено."); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти"); return false; }
    finally { setSaving(false); }
  }

  async function saveAssignment(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedPersonnelId) return;
    await action({ action:"assignment", personnelId:selectedPersonnelId, presetCode, teamIndex, anchorDate });
  }
  async function clearAssignment() {
    if (!selectedPersonnelId) return;
    const ok = await action({ action:"clear_assignment", personnelId:selectedPersonnelId });
    if (ok) setSelectedDate("");
  }
  async function saveOverride(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedPersonnelId || !selectedDate) return;
    await action({ action:"override", personnelId:selectedPersonnelId, shiftDate:selectedDate,
      kind:overrideKind, label:overrideLabel, startTime:overrideStart, endTime:overrideEnd, note:overrideNote });
  }
  async function clearOverride() {
    if (!selectedPersonnelId || !selectedDate) return;
    const ok = await action({ action:"clear_override", personnelId:selectedPersonnelId, shiftDate:selectedDate });
    if (ok) setSelectedDate("");
  }

  const configuredCount = data?.assignments.length || 0;
  const today = new Date().toISOString().slice(0, 10);

  const content = forbidden
    ? <p className="notice error" role="alert">Графік змін доступний лише персоналу цієї організації.</p>
    : !loaded
      ? <p className="notice">Завантаження графіка…</p>
      : <div className="shiftPlanner">
          {!data?.canManage && !data?.personnelLinked && <p className="notice warning">Ваш обліковий запис ще не пов’язаний з кадровою карткою. Зверніться до адміністратора кадрового довідника.</p>}
          <section className="shiftPlannerSummary">
            <article><small>Працівники</small><b>{data?.people.length || 0}</b><span>{data?.canManage ? "активні кадрові картки" : "ваша кадрова картка"}</span></article>
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
            <div className="shiftPlannerActions"><a className="button secondary" href={`/api/staff/shifts?month=${encodeURIComponent(month)}&format=csv`}>CSV</a><button type="button" className="button secondary" onClick={() => window.print()}>Друк</button></div>
          </section>

          {data?.canManage && <section className="shiftPlannerEditor">
            <form className="shiftAssignmentForm" onSubmit={saveAssignment}>
              <div className="shiftEditorHead"><div><h3>Циклічний графік чергувань</h3><p>Це фактичні зміни/чергування. Нормативний тижневий графік роботи ведеться в кадровій картці окремо.</p></div></div>
              <div className="shiftEditorGrid">
                <label><span>Працівник</span><select value={selectedPersonnelId} onChange={(event) => choosePerson(event.target.value)}>{(data?.people || []).map((person) => <option key={person.personnelId} value={person.personnelId}>{person.displayName || person.personnelId}{person.accountEmail ? "" : " · без акаунта"}</option>)}</select></label>
                <label><span>Тип графіка</span><select value={presetCode} onChange={(event) => {setPresetCode(event.target.value);setTeamIndex(1);}}>{CALENDAR6_PRESETS.map((preset) => <option key={preset.code} value={preset.code}>{preset.name}</option>)}</select></label>
                <label><span>Бригада / фаза</span><select value={teamIndex} onChange={(event) => setTeamIndex(Number(event.target.value))}>{Array.from({length:selectedPreset?.teams.length || 0}, (_, index) => <option key={index + 1} value={index + 1}>Бригада {index + 1}</option>)}</select></label>
                <label><span>Опорна дата</span><input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} required /></label>
              </div>
              {selectedPreset?.sourceWarning && <p className="notice warning">{selectedPreset.sourceWarning}</p>}
              <div className="shiftEditorButtons"><button className="button primary" disabled={saving || !selectedPersonnelId} type="submit">{saving ? "Збереження…" : "Зберегти графік"}</button>{selectedAssignment && <button className="button ghost" type="button" disabled={saving} onClick={() => void clearAssignment()}>Прибрати графік</button>}</div>
            </form>

            <form className="shiftOverrideForm" onSubmit={saveOverride}>
              <div><h3>Персональна корекція дня</h3><p>{selectedDate ? `${selectedPerson?.displayName || "Працівник"} · ${selectedDate}` : "Натисніть день у таблиці нижче."}</p></div>
              {selectedDate && <>
                <div className="shiftEditorGrid overrideGrid">
                  <label><span>Тип</span><select value={overrideKind} onChange={(event) => setOverrideKind(event.target.value as ShiftKind)}>{SHIFT_OVERRIDE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label><span>Позначка</span><input value={overrideLabel} maxLength={24} onChange={(event) => setOverrideLabel(event.target.value)} placeholder="Напр. Вп" /></label>
                  <label><span>З</span><input type="time" value={overrideStart} onChange={(event) => setOverrideStart(event.target.value)} /></label>
                  <label><span>До</span><input type="time" value={overrideEnd} onChange={(event) => setOverrideEnd(event.target.value)} /></label>
                  <label className="shiftNoteField"><span>Примітка</span><input value={overrideNote} maxLength={240} onChange={(event) => setOverrideNote(event.target.value)} placeholder="Без медичних даних" /></label>
                </div>
                <div className="shiftEditorButtons"><button className="button primary" disabled={saving} type="submit">Застосувати корекцію</button>{overrides.has(`${selectedPersonnelId}:${selectedDate}`) && <button className="button ghost" type="button" disabled={saving} onClick={() => void clearOverride()}>Повернути цикл</button>}</div>
              </>}
            </form>
          </section>}

          {notice && <p className="notice success" role="status">{notice}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}

          <section className="shiftCalendarCard">
            <div className="shiftCalendarIntro"><div><h3>Табель змін · {monthLabel(month)}</h3><p>Клік по дню відкриває персональну корекцію. Жирна крапка означає ручний виняток від циклу.</p></div><div className="shiftLegend"><span className="day">Д</span><small>день</small><span className="night">Н</span><small>ніч</small><span className="off">В</span><small>вихідний</small><span className="leave">Вп</span><small>відпустка</small></div></div>
            <div className="shiftTableWrap"><table className="shiftTable">
              <thead><tr><th className="shiftPersonColumn">Працівник</th>{dates.map((date) => <th key={date} className={date === today ? "today" : ""}><b>{date.slice(-2)}</b><small>{dateLabel(date)}</small></th>)}</tr></thead>
              <tbody>{(data?.people || []).map((person) => {
                const assignment = assignments.get(person.personnelId);
                const preset = assignment ? shiftPreset(assignment.presetCode) : null;
                return <tr key={person.personnelId}>
                  <th className="shiftPersonColumn"><b>{person.displayName || person.personnelId}</b><small>{[person.militaryRank,person.positionTitle,person.departmentName].filter(Boolean).join(" · ") || (person.role ? roleLabelUk(person.role) : "Кадрова картка")}</small><span>{preset ? `${preset.name} · бригада ${assignment?.teamIndex}` : "Графік не призначено"}{person.accountEmail ? "" : " · без акаунта"}</span></th>
                  {dates.map((date) => {
                    const override = overrides.get(`${person.personnelId}:${date}`);
                    const base = assignment ? resolvePresetShift(assignment.presetCode, assignment.teamIndex, assignment.anchorDate, date) : null;
                    const shift = override ? resolvedOverride(override) : base;
                    const title = `${date} · ${shiftCellText(shift)}${shift?.note ? ` · ${shift.note}` : ""}`;
                    return <td key={date} className={`${date === today ? "today " : ""}${shift ? `kind-${shift.kind}` : "kind-empty"}${override ? " manual" : ""}`}>
                      <button type="button" disabled={!data?.canManage} onClick={() => selectDay(person,date)} title={title} aria-label={`${person.displayName || person.personnelId}, ${date}: ${shiftCellText(shift)}`}>
                        <b>{shift?.label || "—"}</b>{shift?.start || shift?.end ? <small>{shift?.start || "?"}<br/>{shift?.end || "?"}</small> : null}{override && <i aria-label="Ручна корекція">•</i>}
                      </button>
                    </td>;
                  })}
                </tr>;
              })}</tbody>
            </table></div>
            {(data?.people.length || 0) === 0 && <p className="empty">Немає активної кадрової картки для цього доступу.</p>}
          </section>
        </div>;

  return <StaffWorkspaceShell active="schedule" title="Графік змін персоналу" description="Чергування та фактичні зміни прив’язані до кадрової картки personnelId, а не до логіна працівника." staffName={data?.staff.displayName} staffRole={roleLabelUk(data?.staff.role)}>{content}</StaffWorkspaceShell>;
}