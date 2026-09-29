"use client";

import { useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";
import { roleLabelUk } from "../../../../lib/labels";
import { EQUIP_LABELS } from "../../../../lib/schedule";
import type { TatReport } from "../../../../lib/turnaround";

type Staff = { email: string; displayName: string; role: string };

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// Години → людяний підпис. null (немає даних) → «—»; <1 год → хвилини.
function fmtH(h: number | null) {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} хв`;
  return `${h.toLocaleString("uk-UA", { maximumFractionDigits: 1 })} год`;
}
const modLabel = (id: string) => EQUIP_LABELS[id] || id || "Інше";

export default function TurnaroundReportPage() {
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [report, setReport] = useState<TatReport | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Мережевий збій — окремо від access-denied: «Повторити», а не екран входу.
  const [netError, setNetError] = useState(false);

  const load = useCallback(async (f: string, t: string) => {
    try {
      const res = await fetch(`/api/staff/reports/turnaround?from=${f}&to=${t}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Не вдалося завантажити звіт"); return; }
      setError(""); setNetError(false); setReport(data.report || null); setStaff(data.staff || null);
    } catch {
      setNetError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { (async () => { await load(init.from, init.to); })(); }, [load, init.from, init.to]);

  function apply() { setLoading(true); void load(from, to); }

  const o = report?.overall;

  return <StaffWorkspaceShell
    active="reports"
    title="TAT — час до видачі результату"
    description="Скільки минає від виконання дослідження до готового, підписаного й виданого протоколу — за модальністю та лікарем."
    staffName={staff?.displayName || staff?.email}
    staffRole={roleLabelUk(staff?.role)}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Freports%2Fturnaround">Увійти для роботи</a></section> :
    netError ? <section className="accessDenied"><b>Не вдалося завантажити</b><p>Не вдалося завантажити звіт. Перевірте зʼєднання та спробуйте ще раз.</p><button type="button" className="button compact" onClick={()=>{ setNetError(false); setLoading(true); void load(from, to); }}>Повторити</button></section> :
    <section className="reportPanel">
      <div className="utilFilters">
        <label>Від <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>До <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" className="button" onClick={apply} disabled={loading}>{loading ? "…" : "Оновити"}</button>
        <a className="button compact" href="/staff/reports">← До звітів</a>
      </div>

      {loading ? <p className="empty">Рахуємо…</p> : !o ? <p className="empty">Немає даних за період.</p> : <>
        <div className="reportStats">
          <article><span>Виконано</span><b>{o.performed}</b><small>досліджень за період</small></article>
          <article><span>Підписано</span><b>{o.signed}</b><small>{o.ready} готово до підпису</small></article>
          <article><span>Видано</span><b>{o.issued}</b><small>результатів пацієнтам</small></article>
          <article><span>Медіана до підпису</span><b>{fmtH(o.signMedianH)}</b><small>сер. {fmtH(o.signAvgH)}</small></article>
          <article><span>Медіана до видачі</span><b>{fmtH(o.issueMedianH)}</b><small>сер. {fmtH(o.issueAvgH)}</small></article>
        </div>

        <div className="reportTableScroll">
          <table className="utilTable">
            <thead>
              <tr><th>Модальність</th><th>Виконано</th><th>Готово</th><th>Підписано</th><th>Видано</th><th>Медіана до підпису</th><th>Медіана до видачі</th></tr>
            </thead>
            <tbody>
              {report.byModality.map((m) => <tr key={m.equipmentId}>
                <td>{modLabel(m.equipmentId)}</td>
                <td className="num">{m.stats.performed}</td>
                <td className="num">{m.stats.ready}</td>
                <td className="num">{m.stats.signed}</td>
                <td className="num">{m.stats.issued}</td>
                <td className="num">{fmtH(m.stats.signMedianH)}</td>
                <td className="num">{fmtH(m.stats.issueMedianH)}</td>
              </tr>)}
              {report.byModality.length === 0 && <tr><td colSpan={7}>Немає виконаних досліджень.</td></tr>}
            </tbody>
          </table>
        </div>

        {report.byRadiologist.length > 0 && <div className="reportTableScroll" style={{ marginTop: 14 }}>
          <table className="utilTable">
            <thead><tr><th>Лікар-рентгенолог</th><th>Підписано</th><th>Медіана до підпису</th></tr></thead>
            <tbody>
              {report.byRadiologist.map((r) => <tr key={r.email}>
                <td>{r.email}</td>
                <td className="num">{r.signed}</td>
                <td className="num">{fmtH(r.signMedianH)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}

        <p className="utilHint">TAT рахується з фактичних дат: «до підпису» = від виконання (performed_at) до підпису протоколу, «до видачі» = від виконання до видачі пацієнту. Медіана стійкіша до поодиноких викидів, ніж середнє. Розбивка за лікарем — за тим, хто підписав протокол.</p>
      </>}
    </section>}
  </StaffWorkspaceShell>;
}
