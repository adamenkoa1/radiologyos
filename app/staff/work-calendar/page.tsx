"use client";

import { useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { workCalendar, holidaysForYear } from "../../../lib/work-calendar";

const WEEKDAY = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const YEARS = [2025, 2026, 2027];

export default function WorkCalendarPage() {
  const [year, setYear] = useState(2026);
  const [includeHolidays, setIncludeHolidays] = useState(false);

  const cal = useMemo(() => workCalendar(year, { includeHolidays }), [year, includeHolidays]);
  const holidays = useMemo(() => holidaysForYear(year).map((h) => {
    const weekday = new Date(`${h.date}T12:00:00Z`).getUTCDay();
    return { ...h, weekday: WEEKDAY[weekday], isWeekend: weekday === 0 || weekday === 6 };
  }), [year]);

  return <StaffWorkspaceShell
    active="personnel"
    title="Норм-календар роботи"
    description="Виробничий календар: помісячна норма робочих днів і годин за п'ятиденкою (8 год/день)."
  >
    <section className="financeToolbar" aria-label="Параметри календаря" style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center" }}>
      <label>Рік{" "}
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
        <input type="checkbox" checked={includeHolidays} onChange={(e) => setIncludeHolidays(e.target.checked)} disabled={!cal.hasHolidayData} />
        Врахувати святкові дні (Україна)
      </label>
      <span style={{ color: "var(--muted, #667)", fontSize: ".82rem" }}>
        {includeHolidays
          ? "Норма зменшена на святкові будні дні."
          : "П'ятиденка без свят — збігається з типовим «Графіком роботи» 1С."}
      </span>
    </section>

    {!cal.hasHolidayData && <p className="notice" role="status">
      Для {year} року перелік свят не заданий — показано чисту п’ятиденку. Додати свята можна у <code>lib/work-calendar.ts</code>.
    </p>}

    <section className="financeSummary" aria-label="Річна норма">
      <article><span>Робочих днів</span><b>{cal.totalDays}</b><small>за рік</small></article>
      <article><span>Норма годин</span><b>{cal.totalHours}</b><small>за рік</small></article>
      <article><span>Середньомісячно</span><b>{cal.avgMonthlyHours}</b><small>годин</small></article>
      <article><span>Годин на день</span><b>{cal.hoursPerDay}</b><small>п’ятиденка</small></article>
    </section>

    <div style={{ overflowX: "auto" }}>
      <table className="financeTable">
        <thead>
          <tr><th>Місяць</th><th style={{ textAlign: "right" }}>Робочих днів</th><th style={{ textAlign: "right" }}>Норма, год</th>{includeHolidays && <th style={{ textAlign: "right" }}>Свята</th>}</tr>
        </thead>
        <tbody>
          {cal.months.map((m) => <tr key={m.month}>
            <td>{m.label}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.workingDays}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.hours}</td>
            {includeHolidays && <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.holidays || ""}</td>}
          </tr>)}
        </tbody>
        <tfoot>
          <tr><th>Разом</th><th style={{ textAlign: "right" }}>{cal.totalDays}</th><th style={{ textAlign: "right" }}>{cal.totalHours}</th>{includeHolidays && <th />}</tr>
        </tfoot>
      </table>
    </div>

    {holidays.length > 0 && <section style={{ marginTop: "18px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Святкові та неробочі дні {year}</h3>
      <p className="notice" role="note" style={{ marginTop: 0 }}>
        Перелік звіряйте щороку: дати рухомих свят (Великдень, Трійця) і законодавчі зміни (напр. 8/9 травня) змінюються. Свято у вихідний норму не зменшує.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="financeTable">
          <thead><tr><th>Дата</th><th>День</th><th>Свято</th><th>Вплив на норму</th></tr></thead>
          <tbody>
            {holidays.map((h) => <tr key={h.date}>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{h.date.split("-").reverse().join(".")}</td>
              <td>{h.weekday}</td>
              <td>{h.name}</td>
              <td>{h.isWeekend ? "— (вихідний)" : "−1 робочий день"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>}
  </StaffWorkspaceShell>;
}
